import type { BrowserAuthorityClient } from '../../client/authority/browser-authority-client';
import type { BrowserLogicClient } from '../../client/authority/browser-logic-client';
import type { BrowserComputeRuntime } from '../../client/compute/browser-compute-runtime';
import type { GameExperimentState } from './game-experiment-state';

export function readGameRuntimeDiagnostics(
  authority: BrowserAuthorityClient | null,
  logic: BrowserLogicClient | null,
  compute: BrowserComputeRuntime | null,
  experiments: GameExperimentState,
) {
  return {
    authority: authority?.snapshot ?? null,
    frequencies: authority?.readyState?.frequencies ?? null,
    authorityReady: authority?.isReady ?? false,
    logicReady: logic?.isReady ?? false,
    compute: compute?.diagnostics ?? null,
    logic: logic?.diagnostics ?? null,
    experiments: experiments.diagnostics(compute?.diagnostics.workerKernelStates ?? []),
    storageBytes: authority?.storageBytesMeasurement ?? null,
  };
}
