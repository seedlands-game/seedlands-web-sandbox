import { PROTOCOL_VERSION, type SessionEpoch } from './session-protocol';

export type ComputeLane = 'fluid' | 'general';
export type ComputeCategory = 'fluid' | 'chunk-generation' | 'mesh' | 'navigation';
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

  constructor(private readonly options: Readonly<{ epoch: SessionEpoch; maxTasks: number; maxBytes: number }>) {
    this.epoch = options.epoch;
    if (!Number.isInteger(options.maxTasks) || options.maxTasks < 1 || options.maxBytes < 1)
      throw new RangeError('Compute queue limits must be positive.');
  }

  get size() {
    return this.tasks.size;
  }

  get bytes() {
    return this.queuedBytes;
  }

  enqueue(task: ComputeTask): ComputeQueueResult {
    if (task.epoch !== this.epoch) return { status: 'rejected', reason: 'wrong-epoch' };
    if (!this.validTask(task)) return { status: 'rejected', reason: 'invalid-task' };
    const mergeKey = this.mergeKey(task);
    const replacedTaskId = this.mergeKeys.get(mergeKey);
    const replaced = replacedTaskId === undefined ? undefined : this.tasks.get(replacedTaskId);
    const nextTask = replaced ? { ...task, priority: this.higherPriority(replaced.priority, task.priority) } : task;
    const nextCount = this.tasks.size + (replaced ? 0 : 1);
    const nextBytes = this.queuedBytes - (replaced?.estimatedBytes ?? 0) + task.estimatedBytes;
    const overTasks = nextCount > this.options.maxTasks;
    const overBytes = nextBytes > this.options.maxBytes;
    if (overTasks || overBytes)
      return {
        status: 'backpressure',
        reason: overTasks && overBytes ? 'task-and-byte-limit' : overTasks ? 'task-limit' : 'byte-limit',
      };
    if (replaced) this.tasks.delete(replaced.taskId);
    this.tasks.set(task.taskId, nextTask);
    this.mergeKeys.set(mergeKey, task.taskId);
    this.queuedBytes = nextBytes;
    return replaced ? { status: 'merged', replacedTaskId: replaced.taskId } : { status: 'queued' };
  }

  take(lane: ComputeLane): ComputeTask | null {
    const task = [...this.tasks.values()]
      .filter((candidate) => candidate.lane === lane)
      .filter((candidate) => candidate.dependencies.every((dependency) => this.completed.has(dependency)))
      .sort(
        (left, right) => priorityRank[right.priority] - priorityRank[left.priority] || left.taskId - right.taskId,
      )[0];
    if (!task) return null;
    this.remove(task);
    return task;
  }

  complete(taskId: number) {
    this.completed.add(taskId);
  }

  cancel(taskId: number) {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    this.remove(task);
    return true;
  }

  switchEpoch(epoch: SessionEpoch) {
    this.epoch = epoch;
    this.tasks.clear();
    this.mergeKeys.clear();
    this.completed.clear();
    this.queuedBytes = 0;
  }

  private remove(task: ComputeTask) {
    this.tasks.delete(task.taskId);
    this.mergeKeys.delete(this.mergeKey(task));
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
      task.key.length > 0 &&
      task.revision.length > 0 &&
      Number.isSafeInteger(task.estimatedBytes) &&
      task.estimatedBytes >= 0 &&
      ((task.lane === 'fluid' && task.category === 'fluid') || (task.lane === 'general' && task.category !== 'fluid'))
    );
  }
}
