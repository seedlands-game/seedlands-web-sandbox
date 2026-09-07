import {
  ComputeTaskQueue,
  type ComputeLane,
  type ComputeTask,
  type ComputeQueueResult,
} from '../../runtime/compute-task-queue';
import { PROTOCOL_VERSION, type SessionEpoch } from '../../runtime/session-protocol';
import { BoundedCostSamples, type CostSampleWindow } from '../../runtime/bounded-cost-samples';
import type { KernelName, WasmArtifactPreference } from '../../compute/wasm-kernel-contract';

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

export type ComputeWorkerReady = Readonly<{
  kind: 'compute-worker-ready';
  protocolVersion: typeof PROTOCOL_VERSION;
  status: 'off' | 'matched' | 'scalar-fallback' | 'typescript-fallback';
  requestedArtifact: WasmArtifactPreference;
  effectiveArtifact: 'simd' | 'scalar' | 'typescript' | 'off';
  selected: readonly KernelName[];
  reason?: string;
  artifactSha256?: string;
}>;

export type ComputeWorkerKernelDiagnostics = Omit<ComputeWorkerReady, 'kind' | 'protocolVersion'> &
  Readonly<{
    epoch: SessionEpoch;
    lane: ComputeLane;
    index: number;
  }>;

type WorkerSlot = {
  lane: ComputeLane;
  index: number;
  worker: ComputeWorkerPort | null;
  task: ComputeTask | null;
  restartAttempts: number;
  ready: boolean;
  readyTimer: number | null;
  kernelState: ComputeWorkerKernelDiagnostics | null;
};

type PendingTransfer = { transfer: Transferable[] };

type ComputeWorkerPoolOptions = Readonly<{
  epoch: SessionEpoch;
  generalWorkerCount: 1 | 2;
  maxTasks: number;
  maxBytes: number;
  createWorker: (lane: ComputeLane, index: number) => ComputeWorkerPort;
  onResult?: (task: ComputeTask, result: unknown) => void;
  onFailure?: (task: ComputeTask, error: Error) => void;
  onDrop?: (taskId: number, reason: 'merged' | 'cancelled' | 'epoch-switch') => void;
  onPoolFailure?: (lane: ComputeLane, error: Error) => void;
  maxWorkerRestarts?: number;
  restartDelayMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => number;
  clearTimer?: (handle: number) => void;
  requireReadyHandshake?: boolean;
  readyTimeoutMs?: number;
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
  workerTaskDuration: Readonly<Record<ComputeLane, CostSampleWindow>>;
  workerKernelStates: readonly ComputeWorkerKernelDiagnostics[];
}>;

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

function isWorkerReady(value: unknown): value is ComputeWorkerReady {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ComputeWorkerReady>;
  return (
    candidate.kind === 'compute-worker-ready' &&
    candidate.protocolVersion === PROTOCOL_VERSION &&
    ['off', 'matched', 'scalar-fallback', 'typescript-fallback'].includes(candidate.status ?? '') &&
    ['simd', 'scalar', 'off'].includes(candidate.requestedArtifact ?? '') &&
    ['simd', 'scalar', 'typescript', 'off'].includes(candidate.effectiveArtifact ?? '') &&
    Array.isArray(candidate.selected)
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
  private readonly workerTaskDuration: Record<ComputeLane, BoundedCostSamples> = {
    fluid: new BoundedCostSamples(),
    general: new BoundedCostSamples(),
  };
  private disposed = false;
  private readonly restartTimers = new Set<number>();

  constructor(private readonly options: ComputeWorkerPoolOptions) {
    if (options.generalWorkerCount !== 1 && options.generalWorkerCount !== 2)
      throw new RangeError('generalWorkerCount must be 1 or 2.');
    this.epoch = options.epoch;
    this.queue = this.createQueue(options.epoch);
    this.createSlots();
  }

  enqueue(task: ComputeTask, transfer: readonly Transferable[] = []): ComputeQueueResult {
    if (this.disposed || !this.canServiceLane(task.lane)) return { status: 'rejected', reason: 'invalid-task' };
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
    if (this.disposed || !epoch || epoch === this.epoch) return;
    for (const taskId of this.transfers.keys()) this.options.onDrop?.(taskId, 'epoch-switch');
    this.clearRestartTimers();
    this.terminateSlots();
    this.epoch = epoch;
    this.queue = this.createQueue(epoch);
    this.transfers.clear();
    this.cancelledRunning.clear();
    this.createSlots();
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
      workerKernelStates: this.slots.flatMap((slot) => (slot.kernelState ? [slot.kernelState] : [])),
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
    const lanes: ComputeLane[] = ['fluid'];
    for (let index = 0; index < this.options.generalWorkerCount; index += 1) lanes.push('general');
    this.slots = lanes.map((lane, index) => ({
      lane,
      index,
      worker: null,
      task: null,
      restartAttempts: 0,
      ready: !this.options.requireReadyHandshake,
      readyTimer: null,
      kernelState: null,
    }));
    try {
      this.slots.forEach((slot) => this.attachWorker(slot));
    } catch (error) {
      this.terminateSlots();
      throw error;
    }
  }

  private terminateSlots(): void {
    this.slots.forEach((slot) => {
      if (slot.task) this.options.onDrop?.(slot.task.taskId, 'epoch-switch');
      this.clearReadyTimer(slot);
      if (!slot.worker) return;
      slot.worker.onmessage = null;
      slot.worker.onerror = null;
      slot.worker.terminate();
    });
    this.slots = [];
  }

  private pump(): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (slot.task || !slot.worker || !slot.ready) continue;
      const task = this.queue.take(slot.lane);
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
    if (this.options.requireReadyHandshake && isWorkerReady(value)) {
      slot.ready = true;
      slot.kernelState = {
        epoch: this.epoch,
        lane: slot.lane,
        index: slot.index,
        status: value.status,
        requestedArtifact: value.requestedArtifact,
        effectiveArtifact: value.effectiveArtifact,
        selected: value.selected,
        ...(value.reason ? { reason: value.reason } : {}),
        ...(value.artifactSha256 ? { artifactSha256: value.artifactSha256 } : {}),
      };
      this.clearReadyTimer(slot);
      this.pump();
      return;
    }
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
    slot.ready = !this.options.requireReadyHandshake;
    slot.kernelState = null;
    worker.onmessage = (event) => {
      if (slot.worker === worker) this.receive(slot, event.data);
    };
    worker.onerror = (event) => {
      if (slot.worker === worker) this.fail(slot, new Error(event.message || `${slot.lane} compute worker failed.`));
    };
    if (this.options.requireReadyHandshake) {
      const setTimer =
        this.options.setTimer ??
        ((callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs) as unknown as number);
      slot.readyTimer = setTimer(() => {
        slot.readyTimer = null;
        if (!this.disposed && slot.worker === worker && !slot.ready)
          this.recoverSlot(slot, new Error(`${slot.lane} compute worker ready timeout.`));
      }, this.options.readyTimeoutMs ?? 10_000);
    }
  }

  private recoverSlot(slot: WorkerSlot, error: Error): void {
    this.clearReadyTimer(slot);
    const task = slot.task;
    slot.task = null;
    if (task) this.failTask(task, error);
    if (slot.worker) {
      slot.worker.onmessage = null;
      slot.worker.onerror = null;
      slot.worker.terminate();
      slot.worker = null;
    }
    slot.ready = false;
    slot.kernelState = null;
    slot.restartAttempts += 1;
    if (slot.restartAttempts > (this.options.maxWorkerRestarts ?? 3)) {
      this.options.onPoolFailure?.(slot.lane, error);
      if (!this.canServiceLane(slot.lane)) this.failQueuedLane(slot.lane, error);
      this.pump();
      return;
    }
    this.scheduleRestart(slot);
    this.pump();
  }

  private canServiceLane(lane: ComputeLane): boolean {
    const maxRestarts = this.options.maxWorkerRestarts ?? 3;
    return this.slots.some(
      (slot) => slot.lane === lane && (slot.worker !== null || slot.restartAttempts <= maxRestarts),
    );
  }

  private failQueuedLane(lane: ComputeLane, error: Error): void {
    for (const task of this.queue.failLane(lane)) {
      this.transfers.delete(task.taskId);
      this.failedTasks += 1;
      this.options.onFailure?.(task, error);
    }
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

  private clearReadyTimer(slot: WorkerSlot): void {
    if (slot.readyTimer === null) return;
    const clearTimer =
      this.options.clearTimer ??
      ((handle: number) => globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>));
    clearTimer(slot.readyTimer);
    slot.readyTimer = null;
  }
}
