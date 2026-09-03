export const CHUNK_SIZE = 32;
export const GENERATOR_VERSION = 1;

export const Voxel = {
  Air: 0,
  Grass: 1,
  Dirt: 2,
  Stone: 3,
  Wood: 4,
  Leaves: 5,
  Sand: 6,
  Snow: 7,
} as const;

export type VoxelId = (typeof Voxel)[keyof typeof Voxel];

export const voxelNames: Record<number, string> = {
  [Voxel.Grass]: '草方块', [Voxel.Dirt]: '泥土', [Voxel.Stone]: '石头',
  [Voxel.Wood]: '原木', [Voxel.Leaves]: '树叶', [Voxel.Sand]: '沙砾', [Voxel.Snow]: '雪',
};

export const voxelColors: Record<number, [number, number, number]> = {
  [Voxel.Grass]: [0.25, 0.62, 0.25], [Voxel.Dirt]: [0.42, 0.25, 0.12],
  [Voxel.Stone]: [0.45, 0.48, 0.52], [Voxel.Wood]: [0.36, 0.20, 0.08],
  [Voxel.Leaves]: [0.12, 0.40, 0.14], [Voxel.Sand]: [0.76, 0.67, 0.43],
  [Voxel.Snow]: [0.9, 0.95, 1],
};

export const isSolid = (id: number) => id !== Voxel.Air;

export const floorDiv = (n: number, d: number) => Math.floor(n / d);
export const mod = (n: number, d: number) => ((n % d) + d) % d;
export const chunkKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
export const voxelIndex = (x: number, y: number, z: number) => x + CHUNK_SIZE * (z + CHUNK_SIZE * y);

// Coordinate-only hashing means generation is independent of load / worker order.
export function hash2(seed: number, x: number, z: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function normalizeSeed(raw: string): number {
  let h = 2166136261;
  for (let i = 0; i < raw.length; i += 1) h = Math.imul(h ^ raw.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function terrainHeight(seed: number, x: number, z: number): number {
  const broad = Math.sin((x + seed * 0.0001) * 0.028) * 5 + Math.cos((z - seed * 0.0002) * 0.024) * 4;
  const detail = Math.sin(x * 0.113 + z * 0.071) * 1.7 + (hash2(seed, x, z) - .5) * 2;
  return Math.floor(18 + broad + detail);
}

export function biome(seed: number, x: number, z: number): 'plains' | 'desert' | 'alpine' {
  const v = hash2(seed ^ 0x9e3779b9, floorDiv(x, 14), floorDiv(z, 14));
  if (v < .20) return 'desert';
  if (v > .83 || terrainHeight(seed, x, z) > 25) return 'alpine';
  return 'plains';
}

function isTreeOrigin(seed: number, x: number, z: number): boolean {
  return biome(seed, x, z) === 'plains' && hash2(seed ^ 0x44af, x, z) > .985 && terrainHeight(seed, x, z) >= 15;
}

export function baseVoxel(seed: number, x: number, y: number, z: number): VoxelId {
  const h = terrainHeight(seed, x, z);
  const kind = biome(seed, x, z);
  if (y <= h) {
    if (y === h) return kind === 'desert' ? Voxel.Sand : kind === 'alpine' ? Voxel.Snow : Voxel.Grass;
    if (y > h - 4) return kind === 'desert' ? Voxel.Sand : Voxel.Dirt;
    return Voxel.Stone;
  }
  // A feature can be sampled locally from nearby deterministic anchor points.
  for (let tx = x - 3; tx <= x + 3; tx += 1) for (let tz = z - 3; tz <= z + 3; tz += 1) {
    if (!isTreeOrigin(seed, tx, tz)) continue;
    const th = terrainHeight(seed, tx, tz);
    if (x === tx && z === tz && y > th && y <= th + 4) return Voxel.Wood;
    const dx = Math.abs(x - tx), dz = Math.abs(z - tz);
    if (dx <= 2 && dz <= 2 && y >= th + 3 && y <= th + 6 && (dx + dz < 4 || y >= th + 5)) return Voxel.Leaves;
  }
  return Voxel.Air;
}
