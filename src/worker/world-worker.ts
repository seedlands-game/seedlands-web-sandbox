/// <reference lib="webworker" />

import type { ComputeWorkerRequest } from './compute-worker-protocol';
import { createComputeWorkerEntryLifecycle } from './compute-worker-entry-lifecycle';
import { runWorldComputeTask, worldComputeTransfers, type WorldComputePayload } from './world-compute-task';
import { loadWorkerKernels, parseKernelSelection } from './wasm-kernel-loader';
import { worldKernelAdapter } from './world-kernel-adapter';

const scope = self as DedicatedWorkerGlobalScope;
const kernelPromise = loadWorkerKernels(
  parseKernelSelection(scope.name).filter((name) => ['w02', 'w03', 'w04', 'w05', 'w06'].includes(name)),
);
const adapterPromise = kernelPromise.then((state) => {
  Object.assign(scope, { __seedlandsWasm: state });
  return worldKernelAdapter(state);
});
const yieldTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const lifecycle = createComputeWorkerEntryLifecycle({
  postMessage: (message, transfer) => scope.postMessage(message, transfer),
  run: async (task, isCancelled) => {
    const startedAt = performance.now();
    try {
      const result = await runWorldComputeTask(
        task.payload as WorldComputePayload,
        isCancelled,
        yieldTurn,
        await adapterPromise,
      );
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
