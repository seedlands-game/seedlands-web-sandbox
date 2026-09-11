import type { MultiRateScheduler } from '../../runtime/multi-rate-scheduler';
import type { AuthorityKernelExecutionPort } from './authority-kernel-state';
import type { AuthorityServerPort } from './authority-session-types';

type AdvanceCapacityOptions = Readonly<{
  execution: AuthorityKernelExecutionPort;
  server: AuthorityServerPort;
  frequencies: Readonly<{ gameplayHz: number }>;
}>;

export const MAX_AUTHORITY_RECOVERIES_PER_STEP = 4;

export function assertAdvanceCapacity(
  options: AdvanceCapacityOptions,
  scheduler: MultiRateScheduler,
  activeTimeMs: number,
  recoveryQueueSize: number,
  previousActiveTimeMs: number,
): void {
  assertAuthorityAdvanceCapacity(
    options.execution,
    scheduler,
    activeTimeMs,
    options.server,
    recoveryQueueSize,
    MAX_AUTHORITY_RECOVERIES_PER_STEP,
    options.frequencies.gameplayHz,
    activeTimeMs !== previousActiveTimeMs,
  );
}

export function assertAuthorityAdvanceCapacity(
  execution: AuthorityKernelExecutionPort,
  scheduler: MultiRateScheduler,
  activeTimeMs: number,
  server: AuthorityServerPort,
  recoveryQueueSize: number,
  maxRecoveriesPerStep: number,
  gameplayHz: number,
  activeTimeChanged: boolean,
): void {
  const due = scheduler.previewAdvanceTo(activeTimeMs);
  const entities = server.queryEntities();
  const physicsCommits = due.physicsSteps.length * Math.max(1, entities.length);
  const recoveryCommits = Math.min(recoveryQueueSize, due.physicsSteps.length * maxRecoveriesPerStep);
  const pickupCommits = entities.filter(({ type }) => type === 'world-item').length;
  const gameplayCommits = due.gameplay.due
    ? (server.gameplayAdvanceCommitUpperBound?.(due.gameplay.elapsedPeriods / gameplayHz) ?? 1)
    : 0;
  const committedWork = physicsCommits + recoveryCommits + pickupCommits + gameplayCommits;
  const stateOnlyCommit = Number(activeTimeChanged || due.physicsSteps.length > 0 || due.gameplay.due || due.fluid.due);
  execution.assertCanCommit(Math.max(committedWork, stateOnlyCommit));
}
