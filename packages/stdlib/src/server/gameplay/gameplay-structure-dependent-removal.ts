import type { WorldComposition } from '../composition/contracts';
import type { ModuleInvocationValue } from '../composition/contracts';
import type { KernelStateOwner } from '@seedlands/kernel/execution';
import type { WorldCommitResult } from '../game-server-types';
import type { StructurePositionV1 } from './modules/structure-definition';
import type {
  PreparedStructureDependentRemovalV1,
  PreparedStructureParticipant,
} from './modules/structure-host-commit';

const MEDIA_PLAYBACK_CAPABILITY = 'seedlands:media-playback';
type Cell = Readonly<{ voxel: number; fluid: number }>;

const sameCell = (left: Cell | null, right: Cell | null) =>
  left?.voxel === right?.voxel && left?.fluid === right?.fluid;

export function createStructureDependentRemoval(
  composition: WorldComposition,
  readCell: (position: StructurePositionV1) => Cell | null,
  media?: Readonly<{
    prepare(position: StructurePositionV1): PreparedStructureDependentRemovalV1;
  }>,
): (position: StructurePositionV1) => PreparedStructureDependentRemovalV1 {
  const ownsMedia = composition.definitionMap.capabilities.some(({ id }) => id === MEDIA_PLAYBACK_CAPABILITY);
  if (ownsMedia !== Boolean(media))
    throw new TypeError('Structure dependent removal must match the composition Media owner.');
  return (position) => {
    if (media) {
      const removal = media.prepare(position);
      return Object.freeze({
        removed: removal.removed,
        ejectedItem: removal.ejectedItem,
        facts: Object.freeze([...removal.facts]),
        validate() {
          removal.validate();
        },
        apply() {
          removal.apply();
        },
      });
    }
    const expected = readCell(position);
    if (!expected) throw new Error('structure-dependent-cell-unavailable');
    let validated = false;
    let used = false;
    return Object.freeze({
      removed: false,
      ejectedItem: null,
      facts: Object.freeze([]),
      validate() {
        validated = false;
        if (used || !sameCell(readCell(position), expected))
          throw new Error('Prepared Structure dependent removal is stale.');
        validated = true;
      },
      apply() {
        if (used || !validated) throw new Error('Prepared Structure dependent removal requires validation.');
        used = true;
      },
    });
  };
}

export function prepareStructureFactDelivery(
  composition: WorldComposition,
  owner: KernelStateOwner,
  facts: readonly ModuleInvocationValue[],
  precedingWorldCommit: WorldCommitResult,
  gameplayRevision: number,
): PreparedStructureParticipant {
  const ownsMedia = composition.definitionMap.capabilities.some(({ id }) => id === MEDIA_PLAYBACK_CAPABILITY);
  if (ownsMedia) throw new TypeError('Media Structure facts require the registered Media delivery owner.');
  if (facts.length !== 0) throw new TypeError('A composition without Media cannot discard Structure facts.');
  const epoch = owner.epoch;
  const commitSequence = owner.commitSequence;
  let validated = false;
  let used = false;
  return Object.freeze({
    validate() {
      validated = false;
      if (
        used ||
        owner.epoch !== epoch ||
        owner.commitSequence !== commitSequence ||
        owner.worldRevision + 1 !== precedingWorldCommit.worldRevision ||
        owner.gameplayRevision + 1 !== gameplayRevision ||
        facts.length !== 0
      )
        throw new Error('Prepared Structure fact delivery is stale.');
      validated = true;
    },
    apply() {
      if (used || !validated) throw new Error('Prepared Structure fact delivery requires validation.');
      used = true;
    },
  });
}
