import { collisionBoxesForVoxel } from '../../world/voxel-model';

export function playerOccupies(player: readonly number[], voxel: readonly number[]): boolean {
  return (
    voxel[0] + 1 > player[0] - 0.32 &&
    voxel[0] < player[0] + 0.32 &&
    voxel[2] + 1 > player[2] - 0.32 &&
    voxel[2] < player[2] + 0.32 &&
    voxel[1] + 1 > player[1] - 1.6 &&
    voxel[1] < player[1] + 0.2
  );
}

export function playerOccupiesVoxelShape(
  player: readonly number[],
  voxel: readonly number[],
  voxelId: number,
): boolean {
  const playerMin = [player[0] - 0.32, player[1] - 1.6, player[2] - 0.32];
  const playerMax = [player[0] + 0.32, player[1] + 0.2, player[2] + 0.32];
  return collisionBoxesForVoxel(voxelId).some((box) =>
    box.min.every(
      (minimum, axis) => voxel[axis] + box.max[axis] > playerMin[axis] && voxel[axis] + minimum < playerMax[axis],
    ),
  );
}
