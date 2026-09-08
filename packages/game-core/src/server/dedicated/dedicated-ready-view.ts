import type { AuthorityGameplayView, AuthorityReady } from '../../compute/authority-worker-protocol';
import type { AuthoritySnapshot } from '../authority/authority-session';
import type { DedicatedComputeExecutor } from '../compute/dedicated-compute-contract';

export const projectDedicatedReady = (
  initial: AuthorityReady,
  snapshot: AuthoritySnapshot,
  gameplay: AuthorityGameplayView,
): AuthorityReady => ({
  ...initial,
  playerBodyPosition: [
    snapshot.player.body.position.x,
    snapshot.player.body.position.y,
    snapshot.player.body.position.z,
  ],
  worldTime: snapshot.worldTime,
  snapshot,
  gameplay,
});

export const projectDedicatedPlayerActionIdentity = (
  epoch: string,
  issuer: string,
  sequence: number,
  expectedCommitSequence?: number,
) => ({
  epoch,
  issuer,
  stream: 'player-actions',
  sequence,
  ...(expectedCommitSequence === undefined ? {} : { expectedCommitSequence }),
});

export const projectDedicatedComputeIdentity = (epoch: string, executor: DedicatedComputeExecutor) => ({
  epoch,
  generation: executor.diagnostics().generation,
});
