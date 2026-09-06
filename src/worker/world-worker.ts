/// <reference lib="webworker" />

import type { ComputeWorkerRequest } from './compute-worker-protocol';
import { createComputeWorkerEntryLifecycle } from './compute-worker-entry-lifecycle';
import { runWorldComputeTask, worldComputeTransfers, type WorldComputePayload } from './world-compute-task';

const scope = self as DedicatedWorkerGlobalScope;
const yieldTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const lifecycle = createComputeWorkerEntryLifecycle({
  postMessage: (message, transfer) => scope.postMessage(message, transfer),
  run: async (task, isCancelled) => {
    const startedAt = performance.now();
    try {
      const result = await runWorldComputeTask(task.payload as WorldComputePayload, isCancelled, yieldTurn);
      return {
        ok: true,
        workerDurationMs: performance.now() - startedAt,
        result,
        transfer: worldComputeTransfers(result),
      };
    } catch (error) {
      return { ok: false, workerDurationMs: performance.now() - startedAt, error };
    }
  },
});

scope.onmessage = (event: MessageEvent<ComputeWorkerRequest>) => lifecycle.handle(event.data);
