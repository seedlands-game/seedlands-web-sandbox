import type { ComputeWorkerResult } from '../client/compute/compute-worker-pool';
import type { ComputeTask } from '@seedlands/game-core/runtime/compute-task-queue';

export type RunComputeTask = Readonly<{ kind: 'run-compute-task'; task: ComputeTask }>;
export type CancelComputeTask = Readonly<{
  kind: 'cancel-compute-task';
  protocolVersion: 1;
  epoch: string;
  taskId: number;
}>;

export type ComputeWorkerRequest = RunComputeTask | CancelComputeTask;
export type { ComputeWorkerResult };
