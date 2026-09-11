/// <reference lib="webworker" />

import { consumeFluidCandidate, type FluidAuthoritySnapshot } from '@seedlands/stdlib/server/fluid/fluid-transaction';
import type { ComputeWorkerRequest } from './compute-worker-protocol';
import { createComputeWorkerEntryLifecycle } from './compute-worker-entry-lifecycle';
import { loadWorkerKernels, workerKernelReadyState } from './wasm-kernel-loader';
import { parseWasmWorkerName } from '../client/compute/wasm-experiment-selection';
import { createFluidKernel } from './fluid-kernel';
import type { KernelMemory } from '../compute/kernel-memory';

const scope = self as DedicatedWorkerGlobalScope;
const requested = parseWasmWorkerName(scope.name);
let kernelMemory: KernelMemory | null = null;
const computePromise = loadWorkerKernels({
  artifact: requested.artifact,
  kernels: requested.kernels.filter((name) => name === 'w07'),
}).then((state) => {
  kernelMemory = state.memory;
  Object.assign(scope, { __seedlandsWasm: state });
  scope.postMessage({ kind: 'compute-worker-ready', protocolVersion: 1, ...workerKernelReadyState(state) });
  return state.memory ? createFluidKernel(state.memory, consumeFluidCandidate) : consumeFluidCandidate;
});
const yieldTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const lifecycle = createComputeWorkerEntryLifecycle({
  kernelDiagnostics: () => kernelMemory?.diagnostics() ?? null,
  postMessage: (message, transfer) => scope.postMessage(message, transfer),
  run: async (task, isCancelled) => {
    let computeStartedAt = 0;
    try {
      await yieldTurn();
      if (isCancelled()) throw new Error('cancelled');
      const compute = await computePromise;
      if (isCancelled()) throw new Error('cancelled');
      computeStartedAt = performance.now();
      const result = compute(task.payload as FluidAuthoritySnapshot);
      const workerDurationMs = performance.now() - computeStartedAt;
      await yieldTurn();
      return { ok: true, workerDurationMs, result };
    } catch (error) {
      return {
        ok: false,
        ...(computeStartedAt ? { workerDurationMs: performance.now() - computeStartedAt } : {}),
        error,
      };
    }
  },
});

scope.onmessage = (event: MessageEvent<ComputeWorkerRequest>) => lifecycle.handle(event.data);
