import type { MacroContext } from './macro-world';
const IDs = {
  Air: 0,
  Grass: 1,
  Dirt: 2,
  Wood: 4,
  Leaves: 5,
  Sapling: 31,
  TallGrass: 32,
  Flower: 33,
  Mushroom: 34,
  SugarCane: 35,
  Cactus: 36,
} as const;
const hash2 = (seed: number, x: number, z: number) => {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export function vegetationAt(
  seed: number,
  x: number,
  y: number,
  z: number,
  context: MacroContext,
  generatorVersion = 10,
): number | null {
  if (y !== context.terrainHeight + 1 || context.hydrology.water) return null;
  const roll = hash2(seed ^ 0x564547, x, z);
  if (context.biome === 'dry') return roll > 0.992 ? IDs.Cactus : null;
  if (context.biome === 'wet') return roll > 0.94 ? IDs.SugarCane : null;
  if (context.biome === 'forest' && roll > 0.985) return IDs.Mushroom;
  if ((context.biome === 'plains' || context.biome === 'forest') && roll > 0.965) return IDs.Flower;
  const tallGrassThreshold = generatorVersion >= 11 && ['plains', 'forest'].includes(context.biome) ? 0.88 : 0.82;
  if (context.biome !== 'mountain' && context.biome !== 'cold' && roll > tallGrassThreshold) return IDs.TallGrass;
  return null;
}

export function saplingGrowthEdits(
  position: readonly [number, number, number],
  getVoxel: (x: number, y: number, z: number) => number | undefined,
) {
  const [x, y, z] = position;
  if (getVoxel(x, y, z) !== IDs.Sapling || ![IDs.Dirt, IDs.Grass].includes(getVoxel(x, y - 1, z) as 1 | 2)) return null;
  for (let dy = 0; dy <= 6; dy++)
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        const voxel = getVoxel(x + dx, y + dy, z + dz);
        if (voxel === undefined) return null;
        if ((dx !== 0 || dz !== 0 || dy > 4) && voxel !== IDs.Air && voxel !== IDs.Leaves && voxel !== IDs.Sapling)
          return null;
      }
  const edits = [] as { x: number; y: number; z: number; value: number }[];
  for (let dy = 3; dy <= 6; dy++)
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        if (Math.abs(dx) + Math.abs(dz) < 4 && (dy < 6 || Math.abs(dx) + Math.abs(dz) <= 1))
          edits.push({ x: x + dx, y: y + dy, z: z + dz, value: IDs.Leaves });
  for (let dy = 0; dy <= 4; dy++) edits.push({ x, y: y + dy, z, value: IDs.Wood });
  const unique = new Map(edits.map((edit) => [[edit.x, edit.y, edit.z].join(','), edit]));
  return [...unique.values()];
}
