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
