import type { DedicatedComputeTask } from '../../server/compute/dedicated-compute-contract';

/** Validates identity supplied by the host before a task enters the Node pool. */
export function validateNodeComputeTask(
  task: DedicatedComputeTask,
  generation: number,
  expectedEpoch: string | undefined,
): void {
  if (
    !Number.isSafeInteger(task.taskId) ||
    task.taskId < 0 ||
    !task.epoch.trim() ||
    !Number.isSafeInteger(task.generation) ||
    task.generation !== generation ||
    !Number.isSafeInteger(task.estimatedBytes) ||
    task.estimatedBytes < 0
  )
    throw new TypeError('Dedicated compute task identity is invalid or stale.');
  if (expectedEpoch !== undefined && task.epoch !== expectedEpoch)
    throw new TypeError('Dedicated compute task epoch does not match the executor epoch.');
}
