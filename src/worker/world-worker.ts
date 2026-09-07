/// <reference lib="webworker" />

import type { ComputeWorkerRequest } from './compute-worker-protocol';
import { createComputeWorkerEntryLifecycle } from './compute-worker-entry-lifecycle';
import { runWorldComputeTask, worldComputeTransfers, type WorldComputePayload } from './world-compute-task';
import { loadWorkerKernels, workerKernelReadyState } from './wasm-kernel-loader';
import { parseWasmWorkerName } from '../client/compute/wasm-experiment-selection';
import { worldKernelAdapter } from './world-kernel-adapter';

const scope = self as DedicatedWorkerGlobalScope;
const requested = parseWasmWorkerName(scope.name);
const kernelPromise = loadWorkerKernels({
  artifact: requested.artifact,
  kernels: requested.kernels.filter((name) => ['w02', 'w03', 'w04', 'w05', 'w06'].includes(name)),
});
const adapterPromise = kernelPromise.then((state) => {
  Object.assign(scope, { __seedlandsWasm: state });
  scope.postMessage({ kind: 'compute-worker-ready', protocolVersion: 1, ...workerKernelReadyState(state) });
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
