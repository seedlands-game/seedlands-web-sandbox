import { findSafeModeLanding } from '../authority/creative-physics';
import { CHUNK_SIZE, chunkKey } from '../../world/voxel';
import type { GameplayEntity } from './entity-store';

/** Adapts the authority voxel reader to the existing safe landing query. */
export function findGameplayModeLanding(
  entity: GameplayEntity,
  getVoxel: (position: [number, number, number]) => number | undefined,
  revision: number,
) {
  if (entity.type === 'station') throw new TypeError('Station has no actor mode landing.');
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
  );
}
