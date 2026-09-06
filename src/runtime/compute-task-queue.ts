import { PROTOCOL_VERSION, type SessionEpoch } from './session-protocol';

export type ComputeLane = 'fluid' | 'general' | 'logic';
export type ComputeCategory = 'fluid' | 'chunk-generation' | 'mesh' | 'navigation' | 'logic';
export type ComputePriority = 'interaction' | 'near' | 'streaming' | 'background';

export type ComputeTask = Readonly<{
  protocolVersion: typeof PROTOCOL_VERSION;
  epoch: SessionEpoch;
  taskId: number;
  lane: ComputeLane;
  category: ComputeCategory;
  priority: ComputePriority;
  key: string;
  revision: string;
  dependencies: readonly number[];
  estimatedBytes: number;
  payload: unknown;
}>;

export type ComputeQueueResult =
  | Readonly<{ status: 'queued' }>
  | Readonly<{ status: 'merged'; replacedTaskId: number }>
  | Readonly<{ status: 'backpressure'; reason: 'task-limit' | 'byte-limit' | 'task-and-byte-limit' }>
  | Readonly<{ status: 'rejected'; reason: 'wrong-epoch' | 'invalid-task' }>;

const priorityRank: Record<ComputePriority, number> = {
  interaction: 3,
  near: 2,
  streaming: 1,
  background: 0,
};

export class ComputeTaskQueue {
  private epoch: SessionEpoch;
  private readonly tasks = new Map<number, ComputeTask>();
  private readonly mergeKeys = new Map<string, number>();
  private readonly completed = new Set<number>();
  private queuedBytes = 0;
  private runningBytes = 0;
  private highWatermark = -1;
  private readonly running = new Map<number, ComputeTask>();
  private readonly dispatchCount: Record<ComputeLane, number> = { fluid: 0, general: 0, logic: 0 };
  private readonly enqueuedAt = new Map<number, number>();

  constructor(
    private readonly options: Readonly<{
      epoch: SessionEpoch;
      maxTasks: number;
      maxBytes: number;
      maxRunning?: number;
      includeRunningBytes?: boolean;
    }>,
  ) {
    this.epoch = options.epoch;
    if (
      !Number.isSafeInteger(options.maxTasks) ||
      options.maxTasks < 1 ||
      !Number.isSafeInteger(options.maxBytes) ||
      options.maxBytes < 1 ||
      (options.maxRunning !== undefined && (!Number.isSafeInteger(options.maxRunning) || options.maxRunning < 1))
    )
      throw new RangeError('Compute queue limits must be positive.');
  }

  get size() {
    return this.tasks.size;
  }

  get bytes() {
    return this.queuedBytes;
  }

  get inFlightBytes() {
    return this.runningBytes;
  }

  get reservedBytes() {
    return this.queuedBytes + this.runningBytes;
  }

  enqueue(task: ComputeTask): ComputeQueueResult {
    if (task.epoch !== this.epoch) return { status: 'rejected', reason: 'wrong-epoch' };
    if (
      !this.validTask(task) ||
      task.taskId <= this.highWatermark ||
      task.dependencies.some((id) => !this.tasks.has(id) && !this.running.has(id) && !this.completed.has(id))
    )
      return { status: 'rejected', reason: 'invalid-task' };
    const mergeKey = this.mergeKey(task);
    const replacedTaskId = this.mergeKeys.get(mergeKey);
    const candidate = replacedTaskId === undefined ? undefined : this.tasks.get(replacedTaskId);
    const required =
      candidate &&
      (task.dependencies.includes(candidate.taskId) ||
        [...this.tasks.values()].some((entry) => entry.dependencies.includes(candidate.taskId)));
    const replaced = required ? undefined : candidate;
    const nextTask = {
      ...task,
      priority: replaced ? this.higherPriority(replaced.priority, task.priority) : task.priority,
      dependencies: task.dependencies.filter((id) => !this.completed.has(id)),
    };
    const nextCount = this.tasks.size + (replaced ? 0 : 1);
    const nextBytes = this.queuedBytes - (replaced?.estimatedBytes ?? 0) + task.estimatedBytes;
    const overTasks = nextCount > this.options.maxTasks;
    const overBytes = nextBytes + (this.options.includeRunningBytes ? this.runningBytes : 0) > this.options.maxBytes;
    if (overTasks || overBytes)
      return {
        status: 'backpressure',
        reason: overTasks && overBytes ? 'task-and-byte-limit' : overTasks ? 'task-limit' : 'byte-limit',
      };
    const ageOrigin = replaced ? this.enqueuedAt.get(replaced.taskId)! : this.dispatchCount[task.lane];
    if (replaced) this.remove(replaced);
    this.highWatermark = task.taskId;
    this.enqueuedAt.set(task.taskId, ageOrigin);
    this.tasks.set(task.taskId, nextTask);
    this.mergeKeys.set(mergeKey, task.taskId);
    this.queuedBytes = nextBytes;
    return replaced ? { status: 'merged', replacedTaskId: replaced.taskId } : { status: 'queued' };
  }

  take(lane: ComputeLane): ComputeTask | null {
    if (this.running.size >= (this.options.maxRunning ?? 3)) return null;
    const effectivePriority = (task: ComputeTask) =>
      priorityRank[task.priority] + Math.floor((this.dispatchCount[lane] - this.enqueuedAt.get(task.taskId)!) / 8);
    const task = [...this.tasks.values()]
      .filter((candidate) => candidate.lane === lane && candidate.dependencies.length === 0)
      .sort((left, right) => effectivePriority(right) - effectivePriority(left) || left.taskId - right.taskId)[0];
    if (!task) return null;
    this.remove(task);
    this.running.set(task.taskId, task);
    this.runningBytes += task.estimatedBytes;
    this.dispatchCount[lane] += 1;
    return task;
  }

  complete(taskId: number) {
    const task = this.running.get(taskId);
    if (!task) return;
    this.running.delete(taskId);
    this.runningBytes -= task.estimatedBytes;
    this.completed.add(taskId);
    for (const [id, task] of this.tasks) {
      if (task.dependencies.includes(taskId))
        this.tasks.set(id, { ...task, dependencies: task.dependencies.filter((dependency) => dependency !== taskId) });
    }
    while (this.completed.size > this.options.maxTasks * 4)
      this.completed.delete(this.completed.values().next().value!);
  }

  hasQueued(taskId: number) {
    return this.tasks.has(taskId);
  }

  fail(taskId: number): ComputeTask[] {
    const running = this.running.get(taskId);
    if (running) {
      this.running.delete(taskId);
      this.runningBytes -= running.estimatedBytes;
    }
    this.completed.delete(taskId);
    const failed = new Set([taskId]);
    const removed: ComputeTask[] = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of this.tasks.values()) {
        if (failed.has(task.taskId) || task.dependencies.some((id) => failed.has(id))) {
          this.remove(task);
          failed.add(task.taskId);
          removed.push(task);
          changed = true;
        }
      }
    }
    return removed;
  }

  cancel(taskId: number) {
    if (!this.tasks.has(taskId)) return false;
    this.fail(taskId);
    return true;
  }

  switchEpoch(epoch: SessionEpoch) {
    this.epoch = epoch;
    this.tasks.clear();
    this.mergeKeys.clear();
    this.completed.clear();
    this.running.clear();
    this.enqueuedAt.clear();
    this.highWatermark = -1;
    this.dispatchCount.fluid = 0;
    this.dispatchCount.general = 0;
    this.dispatchCount.logic = 0;
    this.queuedBytes = 0;
    this.runningBytes = 0;
  }

  private remove(task: ComputeTask) {
    this.tasks.delete(task.taskId);
    if (this.mergeKeys.get(this.mergeKey(task)) === task.taskId) this.mergeKeys.delete(this.mergeKey(task));
    this.enqueuedAt.delete(task.taskId);
    this.queuedBytes -= task.estimatedBytes;
  }

  private mergeKey(task: ComputeTask) {
    return `${task.epoch}\u0000${task.category}\u0000${task.key}`;
  }

  private higherPriority(left: ComputePriority, right: ComputePriority): ComputePriority {
    return priorityRank[left] >= priorityRank[right] ? left : right;
  }

  private validTask(task: ComputeTask) {
    return (
      task.protocolVersion === PROTOCOL_VERSION &&
      Number.isSafeInteger(task.taskId) &&
      task.taskId >= 0 &&
      typeof task.key === 'string' &&
      task.key.length > 0 &&
      typeof task.revision === 'string' &&
      Object.hasOwn(priorityRank, task.priority) &&
      ['fluid', 'chunk-generation', 'mesh', 'navigation', 'logic'].includes(task.category) &&
      Array.isArray(task.dependencies) &&
      task.dependencies.length <= this.options.maxTasks &&
      task.dependencies.every((id) => Number.isSafeInteger(id) && id >= 0 && id < task.taskId) &&
      task.revision.length > 0 &&
      Number.isSafeInteger(task.estimatedBytes) &&
      task.estimatedBytes >= 0 &&
      ((task.lane === 'fluid' && task.category === 'fluid') ||
        (task.lane === 'logic' && task.category === 'logic') ||
        (task.lane === 'general' && task.category !== 'fluid' && task.category !== 'logic'))
    );
  }
}
