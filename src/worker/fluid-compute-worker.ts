/// <reference lib="webworker" />

import { computeFluidCandidate, type FluidAuthoritySnapshot } from '../server/fluid/fluid-transaction';
import type { ComputeWorkerRequest } from './compute-worker-protocol';
import { createComputeWorkerEntryLifecycle } from './compute-worker-entry-lifecycle';
import { loadWorkerKernels, parseKernelSelection } from './wasm-kernel-loader';
import { createFluidKernel } from './fluid-kernel';

const scope = self as DedicatedWorkerGlobalScope;
const computePromise = loadWorkerKernels(parseKernelSelection(scope.name).filter((name) => name === 'w07')).then(
  (state) => {
    Object.assign(scope, { __seedlandsWasm: state });
    return state.memory ? createFluidKernel(state.memory) : computeFluidCandidate;
  },
);
const yieldTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const lifecycle = createComputeWorkerEntryLifecycle({
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
