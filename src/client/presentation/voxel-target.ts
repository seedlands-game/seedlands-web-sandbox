import { isSolid } from '../../world/voxel';

type Point = [number, number, number];
export type VoxelTarget = {
  position: Point;
  adjacent: Point | null;
  voxel: number;
  distance: number;
  inRange: boolean;
};

/** Amanatides-Woo traversal; interaction reach matches the server's voxel-center rule. */
export function traceVoxelTarget(
  origin: Point,
  direction: Point,
  getVoxel: (x: number, y: number, z: number) => number,
): VoxelTarget | null {
  const length = Math.hypot(...direction);
  if (!length || ![...origin, ...direction].every(Number.isFinite)) return null;
  const ray = direction.map((v) => v / length);
  const cell = origin.map(Math.floor) as Point;
  const step = ray.map(Math.sign);
  const delta = ray.map((v) => (v ? Math.abs(1 / v) : Infinity));
  const next = ray.map((v, axis) => (v ? (cell[axis] + (v > 0 ? 1 : 0) - origin[axis]) / v : Infinity));
  let distance = 0;
  let adjacent: Point | null = null;
  while (distance <= 7) {
    const voxel = getVoxel(...cell);
    if (isSolid(voxel)) {
      const centerDistance = Math.hypot(...cell.map((v, axis) => v + 0.5 - origin[axis]));
      return { position: [...cell], adjacent, voxel, distance, inRange: centerDistance <= 5 };
    }
    const axis = next[0] <= next[1] && next[0] <= next[2] ? 0 : next[1] <= next[2] ? 1 : 2;
    adjacent = [...cell];
    distance = next[axis];
    cell[axis] += step[axis];
    next[axis] += delta[axis];
  }
  return null;
}
