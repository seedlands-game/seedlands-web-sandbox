/// <reference lib="webworker" />

import { PROTOCOL_VERSION } from '../runtime/session-protocol';
import { computeFluidCandidate, type FluidAuthoritySnapshot } from '../server/fluid/fluid-transaction';
import type { ComputeWorkerRequest } from './compute-worker-protocol';

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
  void yieldTurn()
    .then(() => {
      if (cancelled.has(task.taskId)) throw new Error('cancelled');
      return computeFluidCandidate(task.payload as FluidAuthoritySnapshot);
    })
    .then(async (result) => {
      await yieldTurn();
      if (cancelled.delete(task.taskId)) throw new Error('cancelled');
      scope.postMessage({
        kind: 'compute-result',
        protocolVersion: PROTOCOL_VERSION,
        epoch: task.epoch,
        taskId: task.taskId,
        ok: true,
        result,
      });
    })
    .catch((error) => {
      cancelled.delete(task.taskId);
      scope.postMessage({
        kind: 'compute-result',
        protocolVersion: PROTOCOL_VERSION,
        epoch: task.epoch,
        taskId: task.taskId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
};
