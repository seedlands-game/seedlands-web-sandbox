import { Voxel } from '../../world/voxel';

type Position = readonly [number, number, number];
export type RailShape =
  'north-south' | 'east-west' | 'ascending-north' | 'ascending-south' | 'ascending-west' | 'ascending-east';
const rail = (value: number | undefined) =>
  value === Voxel.Rail || value === Voxel.PoweredRail || value === Voxel.DetectorRail;

export function resolveRailShape(
  position: Position,
  getLoadedVoxel: (position: [number, number, number]) => number | undefined,
): RailShape | null {
  const [x, y, z] = position;
  if (!rail(getLoadedVoxel([x, y, z]))) return null;
  const has = (dx: number, dy: number, dz: number) => rail(getLoadedVoxel([x + dx, y + dy, z + dz]));
  if (has(0, 1, -1)) return 'ascending-north';
  if (has(0, 1, 1)) return 'ascending-south';
  if (has(-1, 1, 0)) return 'ascending-west';
  if (has(1, 1, 0)) return 'ascending-east';
  const eastWest = has(-1, 0, 0) || has(1, 0, 0);
  const northSouth = has(0, 0, -1) || has(0, 0, 1);
  return eastWest && !northSouth ? 'east-west' : 'north-south';
}
