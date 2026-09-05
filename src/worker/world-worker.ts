/// <reference lib="webworker" />

import { PROTOCOL_VERSION } from '../runtime/session-protocol';
import type { ComputeWorkerRequest } from './compute-worker-protocol';
import {
  ComputeTaskCancelled,
  runWorldComputeTask,
  worldComputeTransfers,
  type WorldComputePayload,
} from './world-compute-task';

const scope = self as DedicatedWorkerGlobalScope;
const cancelled = new Set<number>();
const yieldTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

scope.onmessage = (event: MessageEvent<ComputeWorkerRequest>) => {
  const message = event.data;
  if (message.kind === 'cancel-compute-task') {
    cancelled.add(message.taskId);
    return;
  }
  const task = message.task;
  const startedAt = performance.now();
  void runWorldComputeTask(task.payload as WorldComputePayload, () => cancelled.has(task.taskId), yieldTurn)
    .then((result) => {
      if (cancelled.delete(task.taskId)) return;
      scope.postMessage(
        {
          kind: 'compute-result',
          protocolVersion: PROTOCOL_VERSION,
          epoch: task.epoch,
          taskId: task.taskId,
          ok: true,
          workerDurationMs: performance.now() - startedAt,
          result,
        },
        worldComputeTransfers(result),
      );
    })
    .catch((error) => {
      const wasCancelled = error instanceof ComputeTaskCancelled || cancelled.delete(task.taskId);
      scope.postMessage({
        kind: 'compute-result',
        protocolVersion: PROTOCOL_VERSION,
        epoch: task.epoch,
        taskId: task.taskId,
        ok: false,
        workerDurationMs: performance.now() - startedAt,
        error: wasCancelled ? 'cancelled' : error instanceof Error ? error.message : String(error),
      });
    });
};
