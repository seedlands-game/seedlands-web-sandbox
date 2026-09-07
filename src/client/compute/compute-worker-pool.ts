import {
  ComputeTaskQueue,
  type ComputeLane,
  type ComputeTask,
  type ComputeQueueResult,
} from '../../runtime/compute-task-queue';
import { PROTOCOL_VERSION, type SessionEpoch } from '../../runtime/session-protocol';
import { BoundedCostSamples, type CostSampleWindow } from '../../runtime/bounded-cost-samples';

export type ComputeWorkerPort = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
};

export type ComputeWorkerResult = Readonly<{
  kind: 'compute-result';
  protocolVersion: typeof PROTOCOL_VERSION;
  epoch: SessionEpoch;
  taskId: number;
  ok: boolean;
  workerDurationMs?: number;
  result?: unknown;
  error?: string;
}>;

export type BrowserComputeLane = Exclude<ComputeLane, 'logic'>;
type BrowserComputeTask = ComputeTask & Readonly<{ lane: BrowserComputeLane }>;

type WorkerSlot = {
  lane: BrowserComputeLane;
  index: number;
  worker: ComputeWorkerPort | null;
  task: BrowserComputeTask | null;
  restartAttempts: number;
};

type PendingTransfer = { transfer: Transferable[] };

type ComputeWorkerPoolOptions = Readonly<{
  epoch: SessionEpoch;
  generalWorkerCount: 1 | 2;
  maxTasks: number;
  maxBytes: number;
  createWorker: (lane: BrowserComputeLane, index: number) => ComputeWorkerPort;
  onResult?: (task: ComputeTask, result: unknown) => void;
  onFailure?: (task: ComputeTask, error: Error) => void;
  onDrop?: (taskId: number, reason: 'merged' | 'cancelled' | 'epoch-switch') => void;
  onPoolFailure?: (lane: BrowserComputeLane, error: Error) => void;
  maxWorkerRestarts?: number;
  restartDelayMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => number;
  clearTimer?: (handle: number) => void;
}>;

export type ComputePoolDiagnostics = Readonly<{
  workerCount: number;
  fluidWorkerCount: number;
  generalWorkerCount: number;
  running: number;
  queued: number;
  queuedBytes: number;
  cancellationRequests: number;
  staleResults: number;
  failedTasks: number;
  completedTasks: number;
  submittedTasks: number;
  submittedBytes: number;
  maxQueued: number;
  maxQueuedBytes: number;
  workerTaskDuration: Readonly<Record<BrowserComputeLane, CostSampleWindow>>;
}>;

const isBrowserComputeTask = (task: ComputeTask): task is BrowserComputeTask => task.lane !== 'logic';

function isWorkerResult(value: unknown): value is ComputeWorkerResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ComputeWorkerResult>;
  return (
    candidate.kind === 'compute-result' &&
    candidate.protocolVersion === PROTOCOL_VERSION &&
    typeof candidate.epoch === 'string' &&
    Number.isSafeInteger(candidate.taskId) &&
    typeof candidate.ok === 'boolean' &&
    (candidate.workerDurationMs === undefined ||
      (Number.isFinite(candidate.workerDurationMs) && candidate.workerDurationMs >= 0))
  );
}

export class ComputeWorkerPool {
  private epoch: SessionEpoch;
  private queue: ComputeTaskQueue;
  private slots: WorkerSlot[] = [];
  private readonly transfers = new Map<number, PendingTransfer>();
  private readonly cancelledRunning = new Set<number>();
  private cancellationRequests = 0;
  private staleResults = 0;
  private failedTasks = 0;
  private completedTasks = 0;
  private submittedTasks = 0;
  private submittedBytes = 0;
  private maxQueued = 0;
  private maxQueuedBytes = 0;
  private readonly workerTaskDuration: Record<BrowserComputeLane, BoundedCostSamples> = {
    fluid: new BoundedCostSamples(),
    general: new BoundedCostSamples(),
  };
  private disposed = false;
  private transitioning = false;
  private readonly restartTimers = new Set<number>();

  constructor(private readonly options: ComputeWorkerPoolOptions) {
    if (options.generalWorkerCount !== 1 && options.generalWorkerCount !== 2)
      throw new RangeError('generalWorkerCount must be 1 or 2.');
    this.epoch = options.epoch;
    this.queue = this.createQueue(options.epoch);
    this.createSlots();
  }

  enqueue(task: ComputeTask, transfer: readonly Transferable[] = []): ComputeQueueResult {
    if (!isBrowserComputeTask(task)) return { status: 'rejected', reason: 'invalid-task' };
    if (this.disposed || this.transitioning) return { status: 'rejected', reason: 'invalid-task' };
    const result = this.queue.enqueue(task);
    if (result.status === 'queued' || result.status === 'merged') {
      this.submittedTasks += 1;
      this.submittedBytes += task.estimatedBytes;
      if (result.status === 'merged') {
        this.transfers.delete(result.replacedTaskId);
        this.options.onDrop?.(result.replacedTaskId, 'merged');
      }
      this.transfers.set(task.taskId, { transfer: [...transfer] });
      this.pump();
      this.maxQueued = Math.max(this.maxQueued, this.queue.size);
      this.maxQueuedBytes = Math.max(this.maxQueuedBytes, this.queue.bytes);
    }
    return result;
  }

  cancel(taskId: number): boolean {
    if (this.disposed || this.transitioning) return false;
    if (this.queue.hasQueued(taskId)) {
      const removed = this.queue.fail(taskId);
      for (const task of removed) if (task.taskId !== taskId) this.reportDependencyFailure(task);
      this.transfers.delete(taskId);
      this.cancellationRequests += 1;
      this.options.onDrop?.(taskId, 'cancelled');
      return true;
    }
    const slot = this.slots.find((candidate) => candidate.task?.taskId === taskId);
    if (!slot || this.cancelledRunning.has(taskId)) return false;
    this.cancelledRunning.add(taskId);
    this.cancellationRequests += 1;
    try {
      slot.worker?.postMessage({
        kind: 'cancel-compute-task',
        protocolVersion: PROTOCOL_VERSION,
        epoch: this.epoch,
        taskId,
      });
    } catch (error) {
      this.recoverSlot(slot, error instanceof Error ? error : new Error(String(error)));
    }
    return true;
  }

  switchEpoch(epoch: SessionEpoch): void {
    if (this.disposed || this.transitioning || !epoch || epoch === this.epoch) return;
    this.transitioning = true;
    try {
      const queued = [...this.transfers.keys()];
      this.transfers.clear();
      this.clearRestartTimers();
      this.terminateSlots();
      for (const taskId of queued) this.options.onDrop?.(taskId, 'epoch-switch');
      this.epoch = epoch;
      this.queue = this.createQueue(epoch);
      this.cancelledRunning.clear();
      if (!this.disposed) this.createSlots();
    } finally {
      this.transitioning = false;
    }
  }

  diagnostics(): ComputePoolDiagnostics {
    return {
      workerCount: this.slots.filter((slot) => slot.worker).length,
      fluidWorkerCount: this.slots.filter((slot) => slot.worker && slot.lane === 'fluid').length,
      generalWorkerCount: this.slots.filter((slot) => slot.worker && slot.lane === 'general').length,
      running: this.slots.filter((slot) => slot.task).length,
      queued: this.queue.size,
      queuedBytes: this.queue.bytes,
      cancellationRequests: this.cancellationRequests,
      staleResults: this.staleResults,
      failedTasks: this.failedTasks,
      completedTasks: this.completedTasks,
      submittedTasks: this.submittedTasks,
      submittedBytes: this.submittedBytes,
      maxQueued: this.maxQueued,
      maxQueuedBytes: this.maxQueuedBytes,
      workerTaskDuration: {
        fluid: this.workerTaskDuration.fluid.snapshot(),
        general: this.workerTaskDuration.general.snapshot(),
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const taskId of this.transfers.keys()) this.options.onDrop?.(taskId, 'epoch-switch');
    this.queue.switchEpoch(this.epoch);
    this.clearRestartTimers();
    this.terminateSlots();
    this.transfers.clear();
    this.cancelledRunning.clear();
  }

  private createQueue(epoch: SessionEpoch): ComputeTaskQueue {
    return new ComputeTaskQueue({ epoch, maxTasks: this.options.maxTasks, maxBytes: this.options.maxBytes });
  }

  private createSlots(): void {
    const lanes: BrowserComputeLane[] = ['fluid'];
    for (let index = 0; index < this.options.generalWorkerCount; index += 1) lanes.push('general');
    this.slots = lanes.map((lane, index) => ({ lane, index, worker: null, task: null, restartAttempts: 0 }));
    try {
      this.slots.forEach((slot) => this.attachWorker(slot));
    } catch (error) {
      this.terminateSlots();
      throw error;
    }
  }

  private terminateSlots(): void {
    const slots = this.slots;
    this.slots = [];
    const dropped = slots.flatMap((slot) => (slot.task ? [slot.task.taskId] : []));
    for (const slot of slots) {
      const worker = slot.worker;
      slot.worker = null;
      slot.task = null;
      if (!worker) continue;
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
    for (const taskId of dropped) this.options.onDrop?.(taskId, 'epoch-switch');
  }

  private pump(): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (slot.task || !slot.worker) continue;
      const task = this.queue.take(slot.lane) as BrowserComputeTask | null;
      if (!task) continue;
      slot.task = task;
      const transfer = this.transfers.get(task.taskId)?.transfer ?? [];
      this.transfers.delete(task.taskId);
      try {
        slot.worker.postMessage({ kind: 'run-compute-task', task }, transfer);
      } catch (error) {
        this.recoverSlot(slot, error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private receive(slot: WorkerSlot, value: unknown): void {
    const task = slot.task;
    if (
      !task ||
      !isWorkerResult(value) ||
      value.taskId !== task.taskId ||
      value.epoch !== this.epoch ||
      task.epoch !== this.epoch
    ) {
      this.staleResults += 1;
      return;
    }
    slot.task = null;
    const cancelled = this.cancelledRunning.delete(task.taskId);
    if (value.epoch !== this.epoch || task.epoch !== this.epoch || cancelled) {
      this.staleResults += 1;
      this.failDependencies(task.taskId);
      this.options.onDrop?.(task.taskId, cancelled ? 'cancelled' : 'epoch-switch');
    } else if (!value.ok) this.failTask(task, new Error(value.error || 'Compute worker task failed.'));
    else {
      slot.restartAttempts = 0;
      this.queue.complete(task.taskId);
      this.completedTasks += 1;
      if (value.workerDurationMs !== undefined) this.workerTaskDuration[task.lane].record(value.workerDurationMs);
      this.options.onResult?.(task, value.result);
    }
    this.pump();
  }

  private fail(slot: WorkerSlot, error: Error): void {
    this.recoverSlot(slot, error);
  }

  private failDependencies(taskId: number): void {
    for (const dependent of this.queue.fail(taskId)) this.reportDependencyFailure(dependent);
  }

  private reportDependencyFailure(task: ComputeTask): void {
    this.transfers.delete(task.taskId);
    this.failedTasks += 1;
    this.options.onFailure?.(task, new Error('Compute dependency was cancelled or failed.'));
  }

  private failTask(task: ComputeTask, error: Error): void {
    this.cancelledRunning.delete(task.taskId);
    this.failDependencies(task.taskId);
    this.failedTasks += 1;
    this.options.onFailure?.(task, error);
  }

  private attachWorker(slot: WorkerSlot): void {
    const worker = this.options.createWorker(slot.lane, slot.index);
    slot.worker = worker;
    worker.onmessage = (event) => this.receive(slot, event.data);
    worker.onerror = (event) => this.fail(slot, new Error(event.message || `${slot.lane} compute worker failed.`));
  }

  private recoverSlot(slot: WorkerSlot, error: Error): void {
    const task = slot.task;
    slot.task = null;
    const worker = slot.worker;
    slot.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
    if (task) this.failTask(task, error);
    if (this.disposed || !this.slots.includes(slot)) return;
    slot.restartAttempts += 1;
    if (slot.restartAttempts > (this.options.maxWorkerRestarts ?? 3)) {
      this.options.onPoolFailure?.(slot.lane, error);
      this.pump();
      return;
    }
    this.scheduleRestart(slot);
    this.pump();
  }

  private scheduleRestart(slot: WorkerSlot): void {
    const setTimer =
      this.options.setTimer ??
      ((callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs) as unknown as number);
    let handle = 0;
    handle = setTimer(
      () => {
        if (handle) this.restartTimers.delete(handle);
        if (this.disposed || !this.slots.includes(slot)) return;
        try {
          this.attachWorker(slot);
          this.pump();
        } catch (error) {
          this.recoverSlot(slot, error instanceof Error ? error : new Error(String(error)));
        }
      },
      (this.options.restartDelayMs ?? 25) * 2 ** (slot.restartAttempts - 1),
    );
    if (!slot.worker) this.restartTimers.add(handle);
  }

  private clearRestartTimers(): void {
    const clearTimer =
      this.options.clearTimer ??
      ((handle: number) => globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>));
    this.restartTimers.forEach(clearTimer);
    this.restartTimers.clear();
  }
}
