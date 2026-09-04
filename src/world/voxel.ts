import { macroAt, type MacroBiome, type MacroContext } from './macro-world';

export const CHUNK_SIZE = 32;
export const GENERATOR_VERSION = 2;

export const Voxel = {
  Air: 0,
  Grass: 1,
  Dirt: 2,
  Stone: 3,
  Wood: 4,
  Leaves: 5,
  Sand: 6,
  Snow: 7,
  Water: 8,
} as const;

export type VoxelId = (typeof Voxel)[keyof typeof Voxel];

export const FaceMaterial = {
  GrassTop: 1,
  GrassSide: 2,
  Dirt: 3,
  Stone: 4,
  Sand: 5,
  WoodSide: 6,
  WoodEnd: 7,
  Leaves: 8,
  Snow: 9,
  Water: 10,
} as const;

export type FaceMaterialId = (typeof FaceMaterial)[keyof typeof FaceMaterial];

export const faceMaterialNames: Record<number, string> = {
  [FaceMaterial.GrassTop]: 'grass-top',
  [FaceMaterial.GrassSide]: 'grass-side',
  [FaceMaterial.Dirt]: 'dirt',
  [FaceMaterial.Stone]: 'stone',
  [FaceMaterial.Sand]: 'sand',
  [FaceMaterial.WoodSide]: 'wood-side',
  [FaceMaterial.WoodEnd]: 'wood-end',
  [FaceMaterial.Leaves]: 'leaves',
  [FaceMaterial.Snow]: 'snow',
  [FaceMaterial.Water]: 'water',
};

export const voxelNames: Record<number, string> = {
  [Voxel.Grass]: '草方块',
  [Voxel.Dirt]: '泥土',
  [Voxel.Stone]: '石头',
  [Voxel.Wood]: '原木',
  [Voxel.Leaves]: '树叶',
  [Voxel.Sand]: '沙砾',
  [Voxel.Snow]: '雪',
  [Voxel.Water]: '水',
};

export const voxelColors: Record<number, [number, number, number]> = {
  [Voxel.Grass]: [0.25, 0.62, 0.25],
  [Voxel.Dirt]: [0.42, 0.25, 0.12],
  [Voxel.Stone]: [0.45, 0.48, 0.52],
  [Voxel.Wood]: [0.36, 0.2, 0.08],
  [Voxel.Leaves]: [0.12, 0.4, 0.14],
  [Voxel.Sand]: [0.76, 0.67, 0.43],
  [Voxel.Snow]: [0.9, 0.95, 1],
  [Voxel.Water]: [0.12, 0.4, 0.72],
};

export const isSolid = (id: number) => id !== Voxel.Air && id !== Voxel.Water;
export const isRenderable = (id: number) => id !== Voxel.Air;

export const floorDiv = (n: number, d: number) => Math.floor(n / d);
export const mod = (n: number, d: number) => ((n % d) + d) % d;
export const chunkKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
export const voxelIndex = (x: number, y: number, z: number) => x + CHUNK_SIZE * (z + CHUNK_SIZE * y);

export function faceMaterialFor(id: number, axis: number, positive: boolean): FaceMaterialId {
  if (id === Voxel.Grass)
    return axis === 1 ? (positive ? FaceMaterial.GrassTop : FaceMaterial.Dirt) : FaceMaterial.GrassSide;
  if (id === Voxel.Wood) return axis === 1 ? FaceMaterial.WoodEnd : FaceMaterial.WoodSide;
  return (
    {
      [Voxel.Dirt]: FaceMaterial.Dirt,
      [Voxel.Stone]: FaceMaterial.Stone,
      [Voxel.Leaves]: FaceMaterial.Leaves,
      [Voxel.Sand]: FaceMaterial.Sand,
      [Voxel.Snow]: FaceMaterial.Snow,
      [Voxel.Water]: FaceMaterial.Water,
    } as Record<number, FaceMaterialId>
  )[id];
}

export function remeshChunkKeysForEdit(x: number, y: number, z: number): string[] {
  const cx = floorDiv(x, CHUNK_SIZE),
    cy = floorDiv(y, CHUNK_SIZE),
    cz = floorDiv(z, CHUNK_SIZE);
  const axes = [
    [cx, ...(mod(x, CHUNK_SIZE) === 0 ? [cx - 1] : []), ...(mod(x, CHUNK_SIZE) === CHUNK_SIZE - 1 ? [cx + 1] : [])],
    [cy, ...(mod(y, CHUNK_SIZE) === 0 ? [cy - 1] : []), ...(mod(y, CHUNK_SIZE) === CHUNK_SIZE - 1 ? [cy + 1] : [])],
    [cz, ...(mod(z, CHUNK_SIZE) === 0 ? [cz - 1] : []), ...(mod(z, CHUNK_SIZE) === CHUNK_SIZE - 1 ? [cz + 1] : [])],
  ];
  const keys: string[] = [];
  for (const ax of axes[0]) for (const ay of axes[1]) for (const az of axes[2]) keys.push(chunkKey(ax, ay, az));
  return keys;
}

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

export const terrainHeight = (seed: number, x: number, z: number): number => macroAt(seed, x, z).terrainHeight;

export const biome = (seed: number, x: number, z: number): MacroBiome => macroAt(seed, x, z).biome;

function isTreeOrigin(seed: number, x: number, z: number, context: MacroContext): boolean {
  const threshold: Partial<Record<MacroBiome, number>> = { forest: 0.968, plains: 0.987, wet: 0.981, mountain: 0.995 };
  return (
    !context.hydrology.water &&
    context.terrainHeight >= 15 &&
    hash2(seed ^ 0x44af, x, z) > (threshold[context.biome] ?? 1)
  );
}

export function baseVoxel(
  seed: number,
  x: number,
  y: number,
  z: number,
  context = macroAt(seed, x, z),
  queryMacro = (qx: number, qz: number) => macroAt(seed, qx, qz),
): VoxelId {
  const h = context.terrainHeight;
  const kind = context.biome;
  if (context.hydrology.water && context.hydrology.waterLevel !== null && y > h && y <= context.hydrology.waterLevel)
    return Voxel.Water;
  if (y <= h) {
    if (y === h)
      return kind === 'dry'
        ? Voxel.Sand
        : kind === 'cold'
          ? Voxel.Snow
          : kind === 'mountain'
            ? Voxel.Stone
            : Voxel.Grass;
    if (y > h - 4) return kind === 'dry' ? Voxel.Sand : kind === 'mountain' ? Voxel.Stone : Voxel.Dirt;
    return Voxel.Stone;
  }
  // A feature can be sampled locally from nearby deterministic anchor points.
  for (let tx = x - 3; tx <= x + 3; tx += 1)
    for (let tz = z - 3; tz <= z + 3; tz += 1) {
      const treeContext = queryMacro(tx, tz);
      if (!isTreeOrigin(seed, tx, tz, treeContext)) continue;
      const th = treeContext.terrainHeight;
      if (x === tx && z === tz && y > th && y <= th + 4) return Voxel.Wood;
      const dx = Math.abs(x - tx),
        dz = Math.abs(z - tz);
      if (dx <= 2 && dz <= 2 && y >= th + 3 && y <= th + 6 && (dx + dz < 4 || y >= th + 5)) return Voxel.Leaves;
    }
  return Voxel.Air;
}
