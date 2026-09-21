import type { MacroBiome, MacroContext } from './macro-world';
import type { VoxelId } from './voxel';
import { oreHash } from './ore-generation';

export const GEOLOGY_SALT = 0x47454f39;
const IDS = {
  Air: 0,
  Stone: 3,
  Water: 8,
  Bedrock: 42,
  Gravel: 43,
  LapisOre: 44,
  Clay: 45,
  Ice: 46,
  SnowBlock: 47,
} as const;

/** V9 geology is a final deterministic layer over the frozen V8 terrain output. */
export function geologyVoxel(
  seed: number,
  x: number,
  y: number,
  z: number,
  context: MacroContext,
  base: VoxelId,
  generatorVersion: number,
): VoxelId {
  return geologyVoxelFromColumn(
    seed,
    x,
    y,
    z,
    context.terrainHeight,
    context.biome,
    context.hydrology.waterLevel,
    base,
    generatorVersion,
  );
}

export function geologyVoxelFromColumn(
  seed: number,
  x: number,
  y: number,
  z: number,
  terrainHeight: number,
  biome: MacroBiome,
  waterLevel: number | null,
  base: VoxelId,
  generatorVersion: number,
): VoxelId {
  if (generatorVersion < 9) return base;
  const hash = oreHash(seed, Math.floor(x / 2), Math.floor(y / 2), Math.floor(z / 2), GEOLOGY_SALT);
  if (y <= 0 || (y < 5 && hash % 5 >= y)) return IDS.Bedrock as VoxelId;
  if (biome === 'cold' && base === IDS.Water && y === waterLevel) return IDS.Ice as VoxelId;
  if (biome === 'cold' && base !== IDS.Air && y === terrainHeight - 1) return IDS.SnowBlock as VoxelId;
  if (waterLevel !== null && base !== IDS.Air && y > terrainHeight - 3 && hash % 5 < 3) return IDS.Clay as VoxelId;
  if (base === IDS.Stone && y >= 0 && y < 32 && terrainHeight - y >= 8 && hash % 997 < 20)
    return IDS.LapisOre as VoxelId;
  if (base === IDS.Stone && terrainHeight - y >= 4 && (hash >>> 8) % 97 < 8) return IDS.Gravel as VoxelId;
  return base;
}
