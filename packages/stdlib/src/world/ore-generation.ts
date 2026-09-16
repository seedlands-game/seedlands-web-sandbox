import type { VoxelId } from './voxel';

export const COAL_ORE_SALT = 0x434f414c;
export const IRON_ORE_SALT = 0x49524f4e;

const STONE_VOXEL = 3;
const COAL_ORE_VOXEL = 14;
const IRON_ORE_VOXEL = 15;

// Frozen unsigned 32-bit mix shared byte-for-byte with world-kernels/generation.rs.
// Coordinates are 2x2x2 group coordinates, represented with two's-complement u32 lanes.
export function oreHash(seed: number, groupX: number, groupY: number, groupZ: number, salt: number): number {
  let hash =
    (seed ^ salt ^ Math.imul(groupX, 0x9e3779b1) ^ Math.imul(groupY, 0x85ebca77) ^ Math.imul(groupZ, 0xc2b2ae3d)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function oreVoxel(
  seed: number,
  x: number,
  y: number,
  z: number,
  terrainHeight: number,
  baseVoxel: VoxelId,
  generatorVersion: number,
): VoxelId {
  if (generatorVersion < 4 || baseVoxel !== STONE_VOXEL) return baseVoxel;
  const depth = terrainHeight - y;
  const groupX = Math.floor(x / 2);
  const groupY = Math.floor(y / 2);
  const groupZ = Math.floor(z / 2);
  if (depth >= 8 && oreHash(seed, groupX, groupY, groupZ, IRON_ORE_SALT) % 97 < 6) return IRON_ORE_VOXEL as VoxelId;
  if (depth >= 4 && oreHash(seed, groupX, groupY, groupZ, COAL_ORE_SALT) % 97 < 10) return COAL_ORE_VOXEL as VoxelId;
  return baseVoxel;
}
