import type { KernelStateOwner } from '@seedlands/kernel/execution';
import type { PreparedMediaPlaybackParticipant } from './modules/media-playback-host-commit';
import type { GameplayStructureCounters } from './gameplay-structure-commit';

export function prepareGameplayMediaChange(
  owner: KernelStateOwner,
  counters: GameplayStructureCounters,
  inventoryChanged: boolean,
): PreparedMediaPlaybackParticipant & Readonly<{ revision: number }> {
  const epoch = owner.epoch;
  const gameplayRevision = owner.gameplayRevision;
  const commitSequence = owner.commitSequence;
  const inventoryOperationCount = counters.inventoryOperationCount;
  const eventCount = counters.eventCount;
  const assertCurrent = () => {
    if (
      owner.epoch !== epoch ||
      owner.gameplayRevision !== gameplayRevision ||
      owner.commitSequence !== commitSequence ||
      counters.inventoryOperationCount !== inventoryOperationCount ||
      counters.eventCount !== eventCount
    )
      throw new Error('Prepared media gameplay frontier is stale.');
    owner.assertGameplayCommitCapacity(epoch, 1);
  };
  assertCurrent();
  let validated = false;
  let used = false;
  return Object.freeze({
    revision: gameplayRevision + 1,
    validate() {
      validated = false;
      if (used) throw new Error('Prepared media gameplay change is stale.');
      assertCurrent();
      validated = true;
    },
    apply() {
      if (used || !validated) throw new Error('Prepared media gameplay change requires validation.');
      used = true;
      owner.commitGameplayTransaction(epoch, 1);
      counters.eventCount = eventCount + 1;
      counters.inventoryOperationCount = inventoryOperationCount + Number(inventoryChanged);
    },
  });
}
