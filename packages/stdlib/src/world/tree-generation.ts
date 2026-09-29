import type { MacroBiome, MacroContext } from './macro-world';

const thresholds: Partial<Record<MacroBiome, number>> = { forest: 0.968, plains: 0.987, wet: 0.981, mountain: 0.995 };

export const treeOriginThreshold = (biome: MacroBiome, generatorVersion: number): number =>
  biome === 'forest' && generatorVersion >= 11 ? 0.978 : (thresholds[biome] ?? 1);

export const isTreeOriginContext = (context: MacroContext, roll: number, generatorVersion: number): boolean =>
  !context.hydrology.water &&
  context.terrainHeight >= 15 &&
  roll > treeOriginThreshold(context.biome, generatorVersion);

export const treeVoxelAtOffset = (
  dx: number,
  y: number,
  dz: number,
  terrainHeight: number,
  generatorVersion: number,
): 4 | 5 | null => {
  const crownY = y - terrainHeight;
  if (dx === 0 && dz === 0 && crownY > 0 && crownY <= (generatorVersion >= 11 ? 5 : 4)) return 4;
  if (generatorVersion < 11)
    return dx <= 2 && dz <= 2 && crownY >= 3 && crownY <= 6 && (dx + dz < 4 || crownY >= 5) ? 5 : null;
  return (crownY >= 4 && crownY <= 5 && dx <= 2 && dz <= 2 && dx + dz < 4) ||
    (crownY === 6 && dx <= 1 && dz <= 1) ||
    (crownY === 7 && dx + dz <= 1)
    ? 5
    : null;
};
