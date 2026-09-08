import type { AuthorityGameplayView } from '../../compute/authority-worker-protocol';
import type { WorldCommitResult } from '../game-server-types';
import type { AuthorityAdvanceResult, AuthorityFrequencies } from './authority-runtime-types';
import type { AuthorityLaneTotals, AuthoritySnapshot } from './authority-session-types';

type AdvanceOptions = Readonly<{
  elapsedMs: number;
  currentTimeMs: number;
  frequencies: AuthorityFrequencies;
  laneTotals: () => AuthorityLaneTotals;
  wake: (nowMs: number) => AuthoritySnapshot;
  view: () => AuthorityGameplayView;
  takeCommits: () => readonly WorldCommitResult[];
}>;

export function advanceAuthoritySession(options: AdvanceOptions): AuthorityAdvanceResult {
  if (!Number.isFinite(options.elapsedMs) || options.elapsedMs < 0 || options.elapsedMs > 60_000)
    throw new RangeError('Authority session advance must be finite and within 0..60000ms.');
  const before = options.laneTotals();
  const intervalMs = 1_000 / Math.max(...Object.values(options.frequencies));
  const targetTimeMs = options.currentTimeMs + options.elapsedMs;
  let currentTimeMs = options.currentTimeMs;
  let snapshot = options.wake(currentTimeMs);
  while (currentTimeMs < targetTimeMs) {
    currentTimeMs = Math.min(targetTimeMs, currentTimeMs + intervalMs);
    snapshot = options.wake(currentTimeMs);
  }
  const physicsIntervalMs = 1_000 / options.frequencies.physicsHz;
  while (!snapshot.paused && snapshot.physicsDebtMs + 1e-7 >= physicsIntervalMs) snapshot = options.wake(currentTimeMs);
  const after = options.laneTotals();
  return {
    snapshot,
    lanes: {
      physicsSteps: after.physicsSteps - before.physicsSteps,
      gameplayPeriods: after.gameplayPeriods - before.gameplayPeriods,
      fluidPeriods: after.fluidPeriods - before.fluidPeriods,
    },
    gameplay: options.view(),
    commits: options.takeCommits(),
  };
}
