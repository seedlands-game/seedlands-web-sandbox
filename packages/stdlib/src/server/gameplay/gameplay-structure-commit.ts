import type { KernelStateOwner } from '@seedlands/kernel/execution';
import type { WorldCommitResult } from '../game-server-types';
import type { PreparedStructureParticipant } from './modules/structure-host-commit';

export type GameplayStructureCounters = { inventoryOperationCount: number; eventCount: number };

export function prepareGameplayWorldChange(
  owner: KernelStateOwner,
  counters: GameplayStructureCounters,
  inventoryChanged: boolean,
  precedingWorldCommit: Pick<WorldCommitResult, 'committed' | 'worldRevision'>,
): PreparedStructureParticipant & Readonly<{ revision: number }> {
  return prepareGameplayStructureChange(owner, counters, inventoryChanged, precedingWorldCommit);
}

export function prepareGameplayStructureChange(
  owner: KernelStateOwner,
  counters: GameplayStructureCounters,
  inventoryChanged: boolean,
  precedingWorldCommit: Pick<WorldCommitResult, 'committed' | 'worldRevision'>,
): PreparedStructureParticipant & Readonly<{ revision: number }> {
  const epoch = owner.epoch;
  const worldRevision = owner.worldRevision;
  const gameplayRevision = owner.gameplayRevision;
  const commitSequence = owner.commitSequence;
  const inventoryOperationCount = counters.inventoryOperationCount;
  const eventCount = counters.eventCount;
  if (!precedingWorldCommit.committed || precedingWorldCommit.worldRevision !== worldRevision + 1)
    throw new Error('Prepared Structure world revision is invalid.');

  const assertCurrent = (afterWorldCommit: boolean) => {
    if (
      owner.epoch !== epoch ||
      owner.worldRevision !== worldRevision + Number(afterWorldCommit) ||
      owner.gameplayRevision !== gameplayRevision ||
      owner.commitSequence !== commitSequence + Number(afterWorldCommit) ||
      counters.inventoryOperationCount !== inventoryOperationCount ||
      counters.eventCount !== eventCount
    )
      throw new Error('Prepared Structure gameplay frontier is stale.');
    if (gameplayRevision >= Number.MAX_SAFE_INTEGER)
      throw new RangeError('Prepared Structure gameplay revision is exhausted.');
    if (commitSequence > Number.MAX_SAFE_INTEGER - 2)
      throw new RangeError('Prepared Structure commit sequence is exhausted.');
    owner.assertGameplayCommitCapacity(epoch, 2);
  };
  assertCurrent(false);
  let validated = false;
  let used = false;
  return Object.freeze({
    revision: gameplayRevision + 1,
    validate() {
      validated = false;
      if (used) throw new Error('Prepared Structure gameplay change is stale.');
      assertCurrent(false);
      validated = true;
    },
    apply() {
      if (used || !validated) throw new Error('Prepared Structure gameplay change requires validation.');
      used = true;
      owner.commitGameplayTransaction(epoch, 1);
      counters.eventCount = eventCount + 1;
      counters.inventoryOperationCount = inventoryOperationCount + Number(inventoryChanged);
    },
  });
}
