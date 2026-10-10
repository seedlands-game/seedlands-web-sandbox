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

/** Retains the original anchor order for one column, without carrying state across chunks. */
export function createTreeColumnSampler(
  x: number,
  z: number,
  generatorVersion: number,
  originHeightAt: (x: number, z: number) => number | null,
): (y: number) => 4 | 5 | null {
  const origins: Array<Readonly<{ dx: number; dz: number; height: number }>> = [];
  for (let tx = x - 3; tx <= x + 3; tx += 1)
    for (let tz = z - 3; tz <= z + 3; tz += 1) {
      const height = originHeightAt(tx, tz);
      if (height !== null) origins.push({ dx: Math.abs(x - tx), dz: Math.abs(z - tz), height });
    }
  return (y) => {
    for (const origin of origins) {
      const voxel = treeVoxelAtOffset(origin.dx, y, origin.dz, origin.height, generatorVersion);
      if (voxel !== null) return voxel;
    }
    return null;
  };
}
