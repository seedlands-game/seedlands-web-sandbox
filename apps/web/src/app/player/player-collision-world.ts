import { VoxelCollisionWorld } from '@seedlands/stdlib/server/authority/voxel-collision-world';
import { CHUNK_SIZE, chunkKey, floorDiv } from '@seedlands/stdlib/world/voxel';
import type { PlayerControllerOptions } from './player-controller-types';

export function playerCollisionWorld(world: NonNullable<ReturnType<PlayerControllerOptions['getWorld']>>) {
  return new VoxelCollisionWorld(
    {
      getChunkRevision: (key) => {
        const [cx, cy, cz] = key.split(',').map(Number);
        return world.getChunkRevision(cx!, cy!, cz!);
      },
      getLoadedVoxel: (x, y, z) => {
        const cx = floorDiv(x, CHUNK_SIZE);
        const cy = floorDiv(y, CHUNK_SIZE);
        const cz = floorDiv(z, CHUNK_SIZE);
        const revision = world.getChunkRevision(cx, cy, cz);
        if (revision === null) return null;
        const fluid = world.getFluidCell(x, y, z);
        return {
          voxel: world.getVoxel(x, y, z),
          chunkKey: chunkKey(cx, cy, cz),
          revision,
          ...(fluid ? { fluid: { level: fluid.level } } : {}),
        };
      },
    },
    () => undefined,
    world.authority.voxelSemantics,
    world.authority.voxelGeometry,
  );
}
