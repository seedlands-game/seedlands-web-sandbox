import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
  DedicatedComputeCancelledError,
  type DedicatedComputeDiagnostics,
  type DedicatedComputeExecutor,
  type DedicatedComputeResult,
  type DedicatedComputeTask,
} from '../../server/compute/dedicated-compute-contract';
import { runDedicatedComputeTask } from '../../server/compute/run-dedicated-compute-task';
import { measureNodeComputeBytes } from './node-compute-byte-budget';
import { isNodeComputeResponse, type NodeComputeRequest } from './node-compute-messages';
import { validateNodeComputeTask } from './node-compute-task-validation';

export type NodeComputeExecutorEntryPoints = Readonly<{ worker: URL; child: URL }>;
export type NodeComputeExecutorMode = 'inline' | 'worker-thread' | 'child-process';

export type NodeComputeExecutorOptions = Readonly<{
  mode: NodeComputeExecutorMode;
  generation?: number;
  expectedEpoch?: string;
  maxTasks: number;
  maxBytes: number;
  maxResultBytes?: number;
  poolSize?: number;
  entries?: NodeComputeExecutorEntryPoints;
}>;

type PendingTask = Readonly<{
  task: DedicatedComputeTask;
  actualBytes: number;
  attempt: number;
  resolve: (result: DedicatedComputeResult) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
  timeout?: ReturnType<typeof setTimeout>;
}>;

type Resource = Readonly<{
  send: (request: NodeComputeRequest) => boolean;
  terminate: () => Promise<void>;
  childPid?: number;
  workerThreadId?: number;
}>;

type Slot = {
  readonly index: number;
  resource: Resource | null;
  running: PendingTask | null;
  recovering: boolean;
  terminationToken: number;
  resourceGeneration: number;
  ipcBacklogBytes: number;
  completedTasks: number;
};

const RESTART_WINDOW_MS = 60_000;
const MAX_RESTARTS_PER_WINDOW = 3;

const defaultEntries = (): NodeComputeExecutorEntryPoints => ({
  worker: new URL('./node-compute-worker.js', import.meta.url),
  child: new URL('./node-compute-child.js', import.meta.url),
});

const errorFrom = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));
const maxResultBytesFor = (options: NodeComputeExecutorOptions) => options.maxResultBytes ?? options.maxBytes;

/** Bounded Node pool for immutable snapshots and candidate results. */
class NodeComputeExecutor implements DedicatedComputeExecutor {
  private readonly queued: PendingTask[] = [];
  private readonly slots: Slot[];
  private readonly restartTimes: number[] = [];
  private readonly recoveryTerminations = new Set<Promise<void>>();
  private generation: number;
  private taskIdHighWatermark = -1;
  private queuedBytes = 0;
  private runningBytes = 0;
  private completedTasks = 0;
  private failedTasks = 0;
  private cancelledTasks = 0;
  private staleResults = 0;
  private health: 'healthy' | 'degraded' = 'healthy';
  private closed = false;

  constructor(private readonly options: NodeComputeExecutorOptions) {
    if (!Number.isSafeInteger(options.maxTasks) || options.maxTasks < 1)
      throw new RangeError('Dedicated compute maxTasks must be a positive safe integer.');
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1)
      throw new RangeError('Dedicated compute maxBytes must be a positive safe integer.');
    if (!Number.isSafeInteger(maxResultBytesFor(options)) || maxResultBytesFor(options) < 1)
      throw new RangeError('Dedicated compute maxResultBytes must be a positive safe integer.');
    const poolSize = options.poolSize ?? 1;
    if (!Number.isSafeInteger(poolSize) || poolSize < 1 || poolSize > options.maxTasks)
      throw new RangeError('Dedicated compute poolSize must be between one and maxTasks.');
    if (options.expectedEpoch !== undefined && !options.expectedEpoch.trim())
      throw new TypeError('Dedicated compute expectedEpoch must not be empty.');
    this.generation = options.generation ?? 1;
    if (!Number.isSafeInteger(this.generation) || this.generation < 1)
      throw new RangeError('Dedicated compute generation must be a positive safe integer.');
    this.slots = Array.from({ length: poolSize }, (_, index) => ({
      index,
      resource: null,
      running: null,
      recovering: false,
      terminationToken: 0,
      resourceGeneration: 0,
      ipcBacklogBytes: 0,
      completedTasks: 0,
    }));
  }

  execute(task: DedicatedComputeTask, options: Readonly<{ signal?: AbortSignal; timeoutMs?: number }> = {}) {
    if (this.closed) return Promise.reject(new Error('Dedicated compute executor is closed.'));
    if (this.health === 'degraded') return Promise.reject(new Error('Dedicated compute executor is degraded.'));
    let actualBytes: number;
    try {
      validateNodeComputeTask(task, this.generation, this.options.expectedEpoch);
      actualBytes = measureNodeComputeBytes(task);
      if (task.estimatedBytes < actualBytes)
        throw new RangeError('Dedicated compute task estimate underreports its serialized payload bytes.');
      if (task.taskId <= this.taskIdHighWatermark)
        throw new TypeError('Dedicated compute taskId must be strictly increasing.');
      if (options.signal?.aborted) throw new DedicatedComputeCancelledError();
      if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0))
        throw new RangeError('Dedicated compute timeout must be positive.');
      if (this.queued.length + this.runningCount() >= this.options.maxTasks)
        throw new Error('Dedicated compute queue backpressure: task limit.');
      if (this.queuedBytes + this.runningBytes + actualBytes > this.options.maxBytes)
        throw new Error('Dedicated compute queue backpressure: byte limit.');
    } catch (error) {
      if (error instanceof DedicatedComputeCancelledError) this.cancelledTasks += 1;
      return Promise.reject(errorFrom(error));
    }
    this.taskIdHighWatermark = task.taskId;
    return new Promise<DedicatedComputeResult>((resolve, reject) => {
      const abortListener = () => this.cancel(task.taskId);
      if (options.signal) options.signal.addEventListener('abort', abortListener, { once: true });
      const timeout =
        options.timeoutMs === undefined
          ? undefined
          : setTimeout(() => this.cancel(task.taskId, 'Dedicated compute task timed out.'), options.timeoutMs);
      this.queued.push({
        task,
        actualBytes,
        attempt: 0,
        resolve,
        reject,
        signal: options.signal,
        abortListener,
        timeout,
      });
      this.queuedBytes += actualBytes;
      this.pump();
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.generation += 1;
    const error = new DedicatedComputeCancelledError('Dedicated compute executor was closed.');
    this.rejectQueued(error, true);
    const resources = this.slots.flatMap((slot) => {
      const resource = slot.resource;
      slot.resource = null;
      slot.resourceGeneration += 1;
      if (slot.running) {
        const pending = slot.running;
        slot.running = null;
        this.runningBytes -= pending.actualBytes;
        this.reject(pending, error, true);
      }
      slot.ipcBacklogBytes = 0;
      return resource ? [resource] : [];
    });
    await Promise.all([...resources.map((resource) => resource.terminate()), ...this.recoveryTerminations]);
  }

  diagnostics(): DedicatedComputeDiagnostics {
    this.pruneRestartTimes();
    return {
      mode: this.options.mode,
      generation: this.generation,
      queued: this.queued.length,
      queuedBytes: this.queuedBytes,
      running: this.runningCount(),
      runningBytes: this.runningBytes,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      cancelledTasks: this.cancelledTasks,
      staleResults: this.staleResults,
      childPids: this.slots.flatMap((slot) => (slot.resource?.childPid ? [slot.resource.childPid] : [])),
      workerThreadIds: this.slots.flatMap((slot) =>
        slot.resource?.workerThreadId ? [slot.resource.workerThreadId] : [],
      ),
      poolSize: this.slots.length,
      liveSlots: this.slots.filter(
        (slot) => slot.resource || slot.recovering || (this.options.mode === 'inline' && slot.running),
      ).length,
      terminatingSlots: this.slots.filter((slot) => slot.recovering && !slot.resource).length,
      health: this.health,
      restartCountLastMinute: this.restartTimes.length,
      ipcBacklogBytes: this.slots.reduce((total, slot) => total + slot.ipcBacklogBytes, 0),
      slotCompletedTasks: this.slots.map((slot) => slot.completedTasks),
      taskIdHighWatermark: this.taskIdHighWatermark,
    };
  }

  private pump(): void {
    if (this.closed || this.health === 'degraded') return;
    for (const slot of this.slots) {
      if (slot.running || slot.recovering || !this.queued.length) continue;
      const pending = this.queued.shift()!;
      this.queuedBytes -= pending.actualBytes;
      if (pending.signal?.aborted) {
        this.reject(pending, new DedicatedComputeCancelledError(), true);
        continue;
      }
      slot.running = pending;
      this.runningBytes += pending.actualBytes;
      this.dispatch(slot, pending);
    }
  }

  private dispatch(slot: Slot, pending: PendingTask): void {
    if (this.options.mode === 'inline') {
      slot.resourceGeneration += 1;
      const resourceGeneration = slot.resourceGeneration;
      void Promise.resolve()
        .then(() => runDedicatedComputeTask(pending.task))
        .then(
          (result) =>
            this.receive(slot, {
              kind: 'dedicated-compute-result',
              epoch: pending.task.epoch,
              taskId: pending.task.taskId,
              generation: pending.task.generation,
              resourceGeneration,
              ok: true,
              result,
            }),
          (error: unknown) =>
            this.receive(slot, {
              kind: 'dedicated-compute-result',
              epoch: pending.task.epoch,
              taskId: pending.task.taskId,
              generation: pending.task.generation,
              resourceGeneration,
              ok: false,
              error: errorFrom(error).message,
            }),
        );
      return;
    }
    try {
      const resource = slot.resource ?? this.createResource(slot);
      slot.resource = resource;
      const request: NodeComputeRequest = {
        kind: 'run-dedicated-compute',
        task: pending.task,
        resourceGeneration: slot.resourceGeneration,
        maxResultBytes: maxResultBytesFor(this.options),
      };
      if (!resource.send(request)) slot.ipcBacklogBytes += pending.actualBytes;
    } catch (error) {
      this.handleResourceFailure(slot, errorFrom(error));
    }
  }

  private createResource(slot: Slot): Resource {
    slot.resourceGeneration += 1;
    if (this.options.mode === 'worker-thread') return this.createWorkerResource(slot);
    return this.createChildResource(slot);
  }

  private createWorkerResource(slot: Slot): Resource {
    const worker = new Worker((this.options.entries ?? defaultEntries()).worker);
    const resource: Resource = {
      workerThreadId: worker.threadId,
      send: (request) => {
        worker.postMessage(request);
        return true;
      },
      terminate: async () => {
        await worker.terminate();
      },
    };
    worker.on('message', (message: unknown) => {
      if (slot.resource === resource) this.receive(slot, message);
      else this.staleResults += 1;
    });
    worker.on('error', (error) => {
      if (slot.resource === resource) this.handleResourceFailure(slot, errorFrom(error));
    });
    worker.on('exit', (code) => {
      if (this.closed || slot.resource !== resource) return;
      if (slot.running) this.handleResourceFailure(slot, new Error(`Node compute worker exited with code ${code}.`));
      else this.retireExitedResource(slot, resource);
    });
    return resource;
  }

  private createChildResource(slot: Slot): Resource {
    const child = spawn(process.execPath, [fileURLToPath((this.options.entries ?? defaultEntries()).child)], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'advanced',
    });
    const resource: Resource = {
      childPid: child.pid,
      send: (request) => this.sendChildRequest(child, request),
      terminate: () => this.terminateChild(child),
    };
    child.on('message', (message: unknown) => {
      if (slot.resource === resource) this.receive(slot, message);
      else this.staleResults += 1;
    });
    child.on('error', (error) => {
      if (slot.resource === resource) this.handleResourceFailure(slot, errorFrom(error));
    });
    child.on('exit', (code, signal) => {
      if (this.closed || slot.resource !== resource) return;
      if (slot.running)
        this.handleResourceFailure(slot, new Error(`Node compute child exited: ${code ?? signal ?? '0'}.`));
      else this.retireExitedResource(slot, resource);
    });
    return resource;
  }

  private sendChildRequest(child: ChildProcess, request: NodeComputeRequest): boolean {
    if (!child.connected) throw new Error('Node compute child IPC channel is unavailable.');
    return child.send(request);
  }

  private async terminateChild(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill();
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  }

  private receive(slot: Slot, response: unknown): void {
    const pending = slot.running;
    if (!isNodeComputeResponse(response)) {
      this.handleResourceFailure(slot, new Error('Node compute response schema is invalid.'));
      return;
    }
    if (
      !pending ||
      response.epoch !== pending.task.epoch ||
      response.taskId !== pending.task.taskId ||
      response.generation !== pending.task.generation ||
      response.generation !== this.generation ||
      response.resourceGeneration !== slot.resourceGeneration
    ) {
      this.staleResults += 1;
      if (pending) this.handleResourceFailure(slot, new Error('Node compute response identity is invalid.'));
      return;
    }
    slot.running = null;
    this.runningBytes -= pending.actualBytes;
    slot.ipcBacklogBytes = 0;
    if (!response.ok) this.reject(pending, new Error(response.error), false);
    else if (measureNodeComputeBytes(response.result) > maxResultBytesFor(this.options))
      this.reject(pending, new Error('Dedicated compute result exceeds byte budget.'), false);
    else {
      this.cleanup(pending);
      this.completedTasks += 1;
      slot.completedTasks += 1;
      pending.resolve(response.result);
    }
    this.pump();
  }

  private handleResourceFailure(slot: Slot, error: Error): void {
    if (slot.recovering) return;
    slot.recovering = true;
    const resource = slot.resource;
    slot.resource = null;
    slot.resourceGeneration += 1;
    slot.ipcBacklogBytes = 0;
    const pending = slot.running;
    const recovery = this.finishResourceFailure(slot, resource, pending, error);
    this.trackTermination(recovery);
  }

  private retireExitedResource(slot: Slot, resource: Resource): void {
    if (slot.resource !== resource) return;
    slot.resource = null;
    slot.resourceGeneration += 1;
    slot.ipcBacklogBytes = 0;
    this.pump();
  }

  private trackTermination(termination: Promise<void>): void {
    this.recoveryTerminations.add(termination);
    void termination.then(
      () => this.recoveryTerminations.delete(termination),
      () => this.recoveryTerminations.delete(termination),
    );
  }

  private terminateSlotBeforeReuse(slot: Slot, resource: Resource): void {
    slot.recovering = true;
    const token = ++slot.terminationToken;
    const termination = resource.terminate();
    this.trackTermination(termination);
    void termination.then(
      () => this.releaseTerminatingSlot(slot, token),
      () => this.releaseTerminatingSlot(slot, token),
    );
  }

  private releaseTerminatingSlot(slot: Slot, token: number): void {
    if (slot.terminationToken !== token || slot.resource || slot.running) return;
    slot.recovering = false;
    this.pump();
  }

  private async finishResourceFailure(
    slot: Slot,
    resource: Resource | null,
    pending: PendingTask | null,
    error: Error,
  ): Promise<void> {
    try {
      if (resource) await resource.terminate();
    } finally {
      slot.recovering = false;
    }
    if (!pending || slot.running !== pending) {
      this.pump();
      return;
    }
    slot.running = null;
    this.runningBytes -= pending.actualBytes;
    if (!this.closed && pending.attempt < 1 && this.reserveRestart()) {
      this.queued.unshift({ ...pending, attempt: pending.attempt + 1 });
      this.queuedBytes += pending.actualBytes;
    } else {
      this.reject(
        pending,
        this.health === 'degraded'
          ? new Error('Dedicated compute executor is degraded after restart limit.')
          : this.closed
            ? new DedicatedComputeCancelledError('Dedicated compute executor was closed.')
            : error,
        this.closed,
      );
    }
    if (this.health === 'degraded')
      this.rejectQueued(new Error('Dedicated compute executor is degraded after restart limit.'), false);
    this.pump();
  }

  private reserveRestart(): boolean {
    this.pruneRestartTimes();
    if (this.restartTimes.length >= MAX_RESTARTS_PER_WINDOW) {
      this.health = 'degraded';
      return false;
    }
    this.restartTimes.push(Date.now());
    return true;
  }

  private pruneRestartTimes(): void {
    const earliest = Date.now() - RESTART_WINDOW_MS;
    while (this.restartTimes[0] !== undefined && this.restartTimes[0] <= earliest) this.restartTimes.shift();
  }

  private cancel(taskId: number, message = 'Dedicated compute task was cancelled.'): void {
    const queuedIndex = this.queued.findIndex((pending) => pending.task.taskId === taskId);
    if (queuedIndex >= 0) {
      const [pending] = this.queued.splice(queuedIndex, 1);
      this.queuedBytes -= pending.actualBytes;
      this.reject(pending, new DedicatedComputeCancelledError(message), true);
      return;
    }
    if (!this.slots.some((slot) => slot.running?.task.taskId === taskId)) return;
    this.generation += 1;
    const error = new DedicatedComputeCancelledError(message);
    this.rejectQueued(
      new DedicatedComputeCancelledError('Dedicated compute task was invalidated by a new generation.'),
      true,
    );
    for (const slot of this.slots) {
      const resource = slot.resource;
      slot.resource = null;
      slot.resourceGeneration += 1;
      slot.ipcBacklogBytes = 0;
      if (slot.running) {
        const pending = slot.running;
        slot.running = null;
        this.runningBytes -= pending.actualBytes;
        this.reject(pending, error, true);
      }
      if (resource) this.terminateSlotBeforeReuse(slot, resource);
    }
  }

  private rejectQueued(error: Error, cancelled: boolean): void {
    const pending = this.queued.splice(0);
    this.queuedBytes = 0;
    pending.forEach((entry) => this.reject(entry, error, cancelled));
  }

  private reject(pending: PendingTask, error: Error, cancelled: boolean): void {
    this.cleanup(pending);
    if (cancelled) this.cancelledTasks += 1;
    else this.failedTasks += 1;
    pending.reject(error);
  }

  private cleanup(pending: PendingTask): void {
    if (pending.abortListener && pending.signal) pending.signal.removeEventListener('abort', pending.abortListener);
    if (pending.timeout) clearTimeout(pending.timeout);
  }

  private runningCount(): number {
    return this.slots.filter((slot) => slot.running).length;
  }
}

export function createNodeComputeExecutor(options: NodeComputeExecutorOptions): DedicatedComputeExecutor {
  return new NodeComputeExecutor(options);
}
