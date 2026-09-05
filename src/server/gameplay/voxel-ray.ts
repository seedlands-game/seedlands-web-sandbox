import { isSolid } from '../../world/voxel';

type Position = readonly [number, number, number];

export function voxelRayIsClear(
  from: Position,
  to: Position,
  getVoxel: (x: number, y: number, z: number) => number,
): boolean {
  const delta = to.map((value, index) => value - from[index]);
  const length = Math.sqrt(delta.reduce((total, value) => total + value ** 2, 0));
  if (length <= Number.EPSILON) return true;
  const sourceVoxel = from.map(Math.floor).join(',');
  const targetVoxel = to.map(Math.floor).join(',');
  const steps = Math.ceil(length * 8);
  for (let index = 1; index < steps; index += 1) {
    const ratio = index / steps;
    const voxel: [number, number, number] = [
      Math.floor(from[0] + delta[0] * ratio),
      Math.floor(from[1] + delta[1] * ratio),
      Math.floor(from[2] + delta[2] * ratio),
    ];
    if (voxel.join(',') !== sourceVoxel && voxel.join(',') !== targetVoxel && isSolid(getVoxel(...voxel))) return false;
  }
  return true;
}
