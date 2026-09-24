import { findSafeModeLanding } from '../authority/creative-physics';
import { CHUNK_SIZE, chunkKey } from '../../world/voxel';
import type { GameplayEntity } from './entity-store';
import type { VoxelGeometryResolver } from '../../world/voxel-model';
import type { GameplayCallbacks } from './gameplay-runtime-contracts';
import type { EntityStore } from './entity-store';

/** Adapts the authority voxel reader to the existing safe landing query. */
export function findGameplayModeLanding(
  entity: GameplayEntity,
  getVoxel: (position: [number, number, number]) => number | undefined,
  revision: number,
  geometry?: VoxelGeometryResolver,
) {
  if (entity.type !== 'player' && entity.type !== 'creature' && entity.type !== 'npc')
    throw new TypeError('Entity has no actor mode landing.');
  return findSafeModeLanding(
    { ...entity, type: entity.type },
    {
      getLoadedVoxel(x, y, z) {
        const voxel = getVoxel([x, y, z]);
        return voxel === undefined
          ? null
          : {
              voxel,
              chunkKey: chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)),
              revision,
            };
      },
    },
    geometry,
  );
}

export const gameplayModeLandingFor =
  (
    entities: Pick<EntityStore, 'get'>,
    callbacks: Pick<GameplayCallbacks, 'getVoxel' | 'voxelGeometry'>,
    revision: () => number,
  ) =>
  (id: string): [number, number, number] | null =>
    findGameplayModeLanding(entities.get(id)!, callbacks.getVoxel, revision(), callbacks.voxelGeometry);
