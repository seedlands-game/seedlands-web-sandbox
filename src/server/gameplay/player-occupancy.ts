import { bodyConfigFor, bodyWorldAabb } from '../../physics';
import { overlapDepth } from '../../physics/geometry';
import { collisionBoxesForVoxel } from '../../world/voxel-model';

export function playerOccupiesVoxelShape(
  player: readonly number[],
  voxel: readonly number[],
  voxelId: number,
): boolean {
  const body = bodyWorldAabb(
    { position: { x: player[0], y: player[1], z: player[2] }, velocity: { x: 0, y: 0, z: 0 } },
    bodyConfigFor('player'),
  );
  return collisionBoxesForVoxel(voxelId).some((box) =>
    Boolean(
      overlapDepth(body, {
        min: { x: voxel[0] + box.min[0], y: voxel[1] + box.min[1], z: voxel[2] + box.min[2] },
        max: { x: voxel[0] + box.max[0], y: voxel[1] + box.max[1], z: voxel[2] + box.max[2] },
      }),
    ),
  );
}
