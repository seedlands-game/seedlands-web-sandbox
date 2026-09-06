import { PROTOCOL_VERSION } from '../../runtime/session-protocol';
import {
  ComputeTaskQueue,
  type ComputeCategory,
  type ComputeLane,
  type ComputePriority,
} from '../../runtime/compute-task-queue';
import { measureDedicatedComputeBytes } from './dedicated-compute-bytes';
import type {
  DedicatedComputeExecutor,
  DedicatedComputeResult,
  DedicatedComputeTask,
} from './dedicated-compute-contract';

export type DedicatedComputeWork =
  | Omit<Extract<DedicatedComputeTask, { kind: 'generate-canonical' }>, 'taskId' | 'estimatedBytes'>
  | Omit<Extract<DedicatedComputeTask, { kind: 'find-safe-spawn' }>, 'taskId' | 'estimatedBytes'>
  | Omit<Extract<DedicatedComputeTask, { kind: 'fluid' }>, 'taskId' | 'estimatedBytes'>
  | Omit<Extract<DedicatedComputeTask, { kind: 'logic' }>, 'taskId' | 'estimatedBytes'>;

export type DedicatedComputeSchedulePolicy = Readonly<{
  priority: ComputePriority;
  key: string;
  revision: string;
  dependencies?: readonly number[];
}>;

export type DedicatedComputeCandidate = Readonly<{
  jobId: number;
  result: DedicatedComputeResult;
  acknowledge: () => void;
  fail: (error: unknown) => void;
}>;

export type DedicatedComputeJob = Readonly<{
  jobId: number;
  candidate: Promise<DedicatedComputeCandidate>;
  cancel: () => boolean;
}>;

export type DedicatedComputeSchedulerOptions = Readonly<{
  epoch: string;
  executors: Readonly<{
    general: DedicatedComputeExecutor;
    fluid: DedicatedComputeExecutor;
    logic: DedicatedComputeExecutor;
  }>;
  maxTasks: number;
  maxBytes: number;
  maxResultBytes: number;
  maxRunning?: number;
  executionIdStart?: number;
}>;

type JobState = 'queued' | 'running' | 'delivered';
type Job = {
  readonly jobId: number;
  readonly work: DedicatedComputeWork;
  readonly policy: DedicatedComputeSchedulePolicy;
  readonly inputBytes: number;
  readonly resolve: (candidate: DedicatedComputeCandidate) => void;
  readonly reject: (error: Error) => void;
  state: JobState;
  controller: AbortController | null;
  resultBytes: number;
  resultReserved: boolean;
};

const errorFrom = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

export class DedicatedComputeSupersededError extends Error {
  constructor(readonly jobId: number) {
    super(`Dedicated compute job ${jobId} was superseded before execution.`);
    this.name = 'DedicatedComputeSupersededError';
  }
}

export class DedicatedComputeSchedulerClosedError extends Error {
  constructor() {
    super('Dedicated compute scheduler is closed.');
    this.name = 'DedicatedComputeSchedulerClosedError';
  }
}

/** Schedules candidates only; the host retains authority until candidate acknowledge(). */
export class DedicatedComputeScheduler {
  private readonly queue: ComputeTaskQueue;
  private readonly jobs = new Map<number, Job>();
  private readonly idleWaiters = new Set<() => void>();
  private nextJobId = 0;
  private nextExecutionId: number;
  private heldResultBytes = 0;
  private reservedResultBytes = 0;
  private closed = false;

  constructor(private readonly options: DedicatedComputeSchedulerOptions) {
    if (!options.epoch.trim()) throw new TypeError('Dedicated compute scheduler epoch must not be empty.');
    const uniqueExecutors = [...new Set(Object.values(options.executors))];
    const defaultMaxRunning = uniqueExecutors.reduce((total, executor) => total + executor.diagnostics().poolSize, 0);
    const maxRunning = options.maxRunning ?? defaultMaxRunning;
    for (const value of [options.maxTasks, options.maxBytes, options.maxResultBytes, maxRunning])
      if (!Number.isSafeInteger(value) || value < 1)
        throw new RangeError('Dedicated compute scheduler limits must be positive safe integers.');
    const executionIdStart =
      options.executionIdStart ??
      Math.max(...uniqueExecutors.map((executor) => executor.diagnostics().taskIdHighWatermark + 1));
    if (!Number.isSafeInteger(executionIdStart) || executionIdStart < 0)
      throw new RangeError('Dedicated compute scheduler executionIdStart must be a non-negative safe integer.');
    this.nextExecutionId = executionIdStart;
    this.queue = new ComputeTaskQueue({
      epoch: options.epoch,
      maxTasks: options.maxTasks,
      maxBytes: options.maxBytes,
      maxRunning,
      includeRunningBytes: true,
    });
  }

  schedule(work: DedicatedComputeWork, policy: DedicatedComputeSchedulePolicy): DedicatedComputeJob {
    const jobId = this.nextJobId++;
    let resolve!: (candidate: DedicatedComputeCandidate) => void;
    let reject!: (error: Error) => void;
    const candidate = new Promise<DedicatedComputeCandidate>((resolveCandidate, rejectCandidate) => {
      resolve = resolveCandidate;
      reject = rejectCandidate;
    });
    const cancel = () => this.cancel(jobId);
    if (this.closed) {
      reject(new DedicatedComputeSchedulerClosedError());
      return { jobId, candidate, cancel };
    }
    const inputBytes = measureDedicatedComputeBytes({ ...work, taskId: 0, estimatedBytes: 0 });
    if (
      work.epoch !== this.options.epoch ||
      !policy.key ||
      !policy.revision ||
      !Number.isSafeInteger(work.generation)
    ) {
      reject(new TypeError('Dedicated compute scheduled work identity is invalid.'));
      return { jobId, candidate, cancel };
    }
    if (inputBytes + this.options.maxResultBytes > this.options.maxBytes) {
      reject(new Error('Dedicated compute scheduler input and result reservation exceed its byte budget.'));
      return { jobId, candidate, cancel };
    }
    const replaced = this.mergeableQueuedJob(work, policy);
    if (this.reservedBytes() - (replaced?.inputBytes ?? 0) + inputBytes > this.options.maxBytes) {
      reject(new Error('Dedicated compute scheduler byte backpressure.'));
      return { jobId, candidate, cancel };
    }
    const job: Job = {
      jobId,
      work,
      policy,
      inputBytes,
      resolve,
      reject,
      state: 'queued',
      controller: null,
      resultBytes: 0,
      resultReserved: false,
    };
    const result = this.queue.enqueue({
      protocolVersion: PROTOCOL_VERSION,
      epoch: this.options.epoch,
      taskId: jobId,
      lane: this.laneFor(work),
      category: this.categoryFor(work),
      priority: policy.priority,
      key: policy.key,
      revision: policy.revision,
      dependencies: policy.dependencies ?? [],
      estimatedBytes: inputBytes,
      payload: jobId,
    });
    if (result.status === 'rejected' || result.status === 'backpressure') {
      reject(new Error(`Dedicated compute scheduler rejected job: ${result.status}.`));
      return { jobId, candidate, cancel };
    }
    if (result.status === 'queued' && this.jobs.size >= this.options.maxTasks) {
      this.queue.cancel(jobId);
      reject(new Error('Dedicated compute scheduler task backpressure.'));
      return { jobId, candidate, cancel };
    }
    this.jobs.set(jobId, job);
    if (result.status === 'merged') this.rejectSuperseded(result.replacedTaskId);
    this.pump();
    return { jobId, candidate, cancel };
  }

  async drain(): Promise<void> {
    if (!this.jobs.size) return;
    await new Promise<void>((resolve) => this.idleWaiters.add(resolve));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const jobId of [...this.jobs.keys()]) this.fail(jobId, new DedicatedComputeSchedulerClosedError(), true);
    this.notifyIdle();
  }

  diagnostics() {
    return {
      queued: this.queue.size,
      queuedBytes: this.queue.bytes,
      runningBytes: this.queue.inFlightBytes,
      heldResultBytes: this.heldResultBytes,
      reservedResultBytes: this.reservedResultBytes,
      reservedBytes: this.reservedBytes(),
      pendingJobs: this.jobs.size,
    } as const;
  }

  private pump(): void {
    if (this.closed) return;
    let dispatched = true;
    while (dispatched) {
      dispatched = false;
      for (const lane of ['fluid', 'general', 'logic'] as const) {
        if (!this.canDispatch(lane)) continue;
        if (this.reservedBytes() + this.options.maxResultBytes > this.options.maxBytes) continue;
        const task = this.queue.take(lane);
        if (!task) continue;
        const job = this.jobs.get(task.payload as number);
        if (!job) {
          this.queue.fail(task.taskId);
          continue;
        }
        job.state = 'running';
        job.controller = new AbortController();
        job.resultReserved = true;
        this.reservedResultBytes += this.options.maxResultBytes;
        const execution: DedicatedComputeTask = {
          ...job.work,
          taskId: this.nextExecutionId++,
          estimatedBytes: job.inputBytes,
        };
        void this.options.executors[lane].execute(execution, { signal: job.controller.signal }).then(
          (result) => this.deliver(job.jobId, result),
          (error: unknown) => this.fail(job.jobId, error),
        );
        dispatched = true;
      }
    }
  }

  private canDispatch(lane: ComputeLane): boolean {
    const diagnostics = this.options.executors[lane].diagnostics();
    return diagnostics.health === 'healthy' && diagnostics.running < diagnostics.poolSize;
  }

  private deliver(jobId: number, result: DedicatedComputeResult): void {
    const job = this.jobs.get(jobId);
    if (!job || job.state !== 'running') return;
    const resultBytes = measureDedicatedComputeBytes(result);
    if (resultBytes > this.options.maxResultBytes) {
      this.fail(jobId, new Error('Dedicated compute scheduler result exceeds byte budget.'));
      return;
    }
    job.resultBytes = resultBytes;
    this.heldResultBytes += resultBytes;
    job.state = 'delivered';
    job.resolve({
      jobId,
      result,
      acknowledge: () => this.acknowledge(jobId),
      fail: (error) => this.fail(jobId, error),
    });
  }

  private acknowledge(jobId: number): void {
    const job = this.jobs.get(jobId);
    if (!job || job.state !== 'delivered') return;
    this.heldResultBytes -= job.resultBytes;
    this.releaseResultReservation(job);
    this.queue.complete(jobId);
    this.jobs.delete(jobId);
    this.notifyIdle();
    this.pump();
  }

  private cancel(jobId: number): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.controller?.abort();
    this.fail(jobId, new Error('Dedicated compute job was cancelled.'), true);
    return true;
  }

  private fail(jobId: number, error: unknown, abort = false): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (abort) job.controller?.abort();
    if (job.state === 'delivered') this.heldResultBytes -= job.resultBytes;
    this.releaseResultReservation(job);
    this.jobs.delete(jobId);
    job.reject(errorFrom(error));
    const dependentTasks = this.queue.fail(jobId);
    for (const dependent of dependentTasks) {
      const dependentJob = this.jobs.get(dependent.taskId);
      if (!dependentJob) continue;
      this.releaseResultReservation(dependentJob);
      this.jobs.delete(dependent.taskId);
      dependentJob.reject(new Error(`Dedicated compute dependency ${jobId} failed.`));
    }
    this.notifyIdle();
    this.pump();
  }

  private rejectSuperseded(jobId: number): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    this.jobs.delete(jobId);
    job.reject(new DedicatedComputeSupersededError(jobId));
    this.notifyIdle();
  }

  private releaseResultReservation(job: Job): void {
    if (!job.resultReserved) return;
    job.resultReserved = false;
    this.reservedResultBytes -= this.options.maxResultBytes;
  }

  private reservedBytes(): number {
    return this.queue.reservedBytes + this.reservedResultBytes;
  }

  private laneFor(work: DedicatedComputeWork): ComputeLane {
    if (work.kind === 'fluid') return 'fluid';
    if (work.kind === 'logic') return 'logic';
    return 'general';
  }

  private categoryFor(work: DedicatedComputeWork): ComputeCategory {
    if (work.kind === 'fluid') return 'fluid';
    if (work.kind === 'logic') return 'logic';
    return 'chunk-generation';
  }

  private mergeableQueuedJob(work: DedicatedComputeWork, policy: DedicatedComputeSchedulePolicy): Job | undefined {
    const lane = this.laneFor(work);
    const category = this.categoryFor(work);
    return [...this.jobs.values()].find(
      (candidate) =>
        candidate.state === 'queued' &&
        this.laneFor(candidate.work) === lane &&
        this.categoryFor(candidate.work) === category &&
        candidate.policy.key === policy.key &&
        !(policy.dependencies ?? []).includes(candidate.jobId) &&
        ![...this.jobs.values()].some(
          (dependent) =>
            dependent.state === 'queued' && (dependent.policy.dependencies ?? []).includes(candidate.jobId),
        ),
    );
  }

  private notifyIdle(): void {
    if (this.jobs.size) return;
    const waiters = [...this.idleWaiters];
    this.idleWaiters.clear();
    waiters.forEach((resolve) => resolve());
  }
}
