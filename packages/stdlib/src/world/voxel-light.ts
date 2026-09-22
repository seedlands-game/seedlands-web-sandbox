import { isSolid, Voxel } from './voxel';

/** Classic block light levels, shared by gameplay and the WebGL light volume. */
export function voxelEmission(voxel: number): number {
  switch (voxel) {
    case Voxel.Glowstone:
    case Voxel.Lava:
    case Voxel.Fire:
    case Voxel.JackOLantern:
      return 15;
    case Voxel.Lantern:
    case Voxel.Torch:
      return 14;
    case Voxel.LitFurnace:
      return 13;
    case Voxel.LitRedstoneOre:
      return 9;
    default:
      return 0;
  }
}

/** A closed full block stops propagation. Small models let light around their shape. */
export function voxelLightCost(voxel: number): number {
  if (voxel === Voxel.Water || voxel === Voxel.Leaves || voxel === Voxel.Ice) return 2;
  if (
    !isSolid(voxel) ||
    voxel === Voxel.Glass ||
    voxel === Voxel.Slab ||
    voxel === Voxel.WoodStairs ||
    voxel === Voxel.CobblestoneStairs ||
    voxel === Voxel.Fence ||
    voxel === Voxel.Ladder ||
    voxel === Voxel.Sign ||
    voxel === Voxel.Cake ||
    voxel === Voxel.Bed ||
    voxel === Voxel.Lantern ||
    voxel === Voxel.Torch ||
    voxel === Voxel.Spawner
  )
    return 1;
  return 16;
}

export type BlockLightVolume = {
  size: number;
  origin: readonly [number, number, number];
  levels: Uint8Array;
};

/** Flood all sources together; capacity depends on cells, never on light count. */
export function buildBlockLightVolume(
  size: number,
  origin: readonly [number, number, number],
  getVoxel: (x: number, y: number, z: number) => number | undefined,
): BlockLightVolume {
  if (!Number.isInteger(size) || size < 1 || size > 96) throw new RangeError('Invalid light volume size.');
  const count = size ** 3;
  const levels = new Uint8Array(count);
  const costs = new Uint8Array(count);
  // Descending level buckets ensure each cell is finalized only once.
  const buckets: number[][] = Array.from({ length: 16 }, () => []);
  let index = 0;
  for (let z = 0; z < size; z++)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++, index++) {
        const voxel = getVoxel(x + origin[0], y + origin[1], z + origin[2]);
        costs[index] = voxel === undefined ? 16 : voxelLightCost(voxel);
        const level = voxel === undefined ? 0 : voxelEmission(voxel);
        levels[index] = level;
        if (level) buckets[level].push(index);
      }
  const plane = size * size;
  const visit = (next: number, level: number) => {
    const propagated = level - costs[next];
    if (propagated > levels[next]) {
      levels[next] = propagated;
      buckets[propagated].push(next);
    }
  };
  for (let level = 15; level > 1; level--) {
    for (const cell of buckets[level]) {
      if (levels[cell] !== level) continue;
      const x = cell % size;
      const y = Math.floor(cell / size) % size;
      const z = Math.floor(cell / plane);
      if (x > 0) visit(cell - 1, level);
      if (x + 1 < size) visit(cell + 1, level);
      if (y > 0) visit(cell - size, level);
      if (y + 1 < size) visit(cell + size, level);
      if (z > 0) visit(cell - plane, level);
      if (z + 1 < size) visit(cell + plane, level);
    }
  }
  return { size, origin, levels };
}

export function sampleBlockLight(volume: BlockLightVolume, x: number, y: number, z: number): number {
  x = Math.floor(x) - volume.origin[0];
  y = Math.floor(y) - volume.origin[1];
  z = Math.floor(z) - volume.origin[2];
  if (Math.min(x, y, z) < 0 || Math.max(x, y, z) >= volume.size) return 0;
  return volume.levels[x + volume.size * (y + volume.size * z)];
}
