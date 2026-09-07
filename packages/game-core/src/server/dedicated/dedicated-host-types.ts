import type { AuthorityRuntimeOptions } from '../authority/authority-runtime';
import type { DedicatedComputeExecutor } from '../compute/dedicated-compute-contract';
import type { AuthoritySnapshot } from '../authority/authority-session';
import type { AuthorityGameplayView } from '../../compute/authority-worker-protocol';
import type { WorldCommitResult } from '../game-server-types';

export type DedicatedHostOptions = Omit<
  AuthorityRuntimeOptions,
  | 'startTimeMs'
  | 'onUnknownChunk'
  | 'onFluidWork'
  | 'onLogicObservation'
  | 'findInitialWorldBootstrap'
  | 'initialWorldTime'
> & {
  now: () => number;
  initialWorldTime?: number;
  activeRadius?: 1 | 2 | 3;
  executors: Readonly<{
    general: DedicatedComputeExecutor;
    fluid: DedicatedComputeExecutor;
    logic: DedicatedComputeExecutor;
  }>;
  limits?: Partial<
    Readonly<{
      mailboxCount: number;
      mailboxBytes: number;
      computeResultBytes: number;
      pendingChunks: number;
      inputLeaseMs: number;
      saveIntervalMs: number;
    }>
  >;
};

export type DedicatedPublication = Readonly<{
  snapshot: AuthoritySnapshot;
  gameplay?: AuthorityGameplayView;
  commits: readonly WorldCommitResult[];
}>;

export type DedicatedHostState = 'running' | 'draining' | 'stopped' | 'failed';

export { measureDedicatedComputeBytes as estimateComputeBytes } from '../compute/dedicated-compute-bytes';

export function dedicatedLimits(options: DedicatedHostOptions['limits']) {
  const limits = {
    mailboxCount: 256,
    mailboxBytes: 16 * 1024 * 1024,
    computeResultBytes: Math.min(4 * 1024 * 1024, options?.mailboxBytes ?? 16 * 1024 * 1024),
    pendingChunks: 256,
    inputLeaseMs: 500,
    saveIntervalMs: 10_000,
    ...options,
  };
  for (const [key, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`Invalid dedicated host limit: ${key}`);
  if (limits.computeResultBytes >= limits.mailboxBytes)
    throw new RangeError('Dedicated compute result reservation must leave room for input bytes.');
  return limits;
}
