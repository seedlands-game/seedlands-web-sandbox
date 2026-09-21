export type DungeonDescriptor = Readonly<{
  id: string;
  center: readonly [number, number, number];
  radiusX: number;
  radiusZ: number;
  entrance: 'north' | 'south' | 'west' | 'east';
}>;
const mix = (seed: number, x: number, z: number) => {
  let h = (seed ^ 0x44554e47 ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(z, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
};
export function dungeonFor(seed: number, x: number, z: number, version: number): DungeonDescriptor | null {
  if (version < 8) return null;
  const rx = Math.floor(x / 64),
    rz = Math.floor(z / 64),
    h = mix(seed, rx, rz);
  if (h % 7 !== 0) return null;
  const cx = rx * 64 + 16 + ((h >>> 4) % 32),
    cz = rz * 64 + 16 + ((h >>> 10) % 32),
    cy = 5 + ((h >>> 16) % 18);
  return Object.freeze({
    id: 'dungeon:' + rx + ',' + rz,
    center: [cx, cy, cz] as const,
    radiusX: 3 + (h & 1),
    radiusZ: 3 + ((h >>> 1) & 1),
    entrance: (['north', 'south', 'west', 'east'] as const)[(h >>> 2) & 3],
  });
}
export function dungeonVoxel(d: DungeonDescriptor, x: number, y: number, z: number) {
  const [cx, cy, cz] = d.center,
    dx = Math.abs(x - cx),
    dy = Math.abs(y - cy),
    dz = Math.abs(z - cz);
  if (dx > d.radiusX || dz > d.radiusZ || dy > 2) return null;
  const boundary = dx === d.radiusX || dz === d.radiusZ || dy === 2;
  const entrance =
    y === cy &&
    ((d.entrance === 'north' && z === cz - d.radiusZ && dx === 0) ||
      (d.entrance === 'south' && z === cz + d.radiusZ && dx === 0) ||
      (d.entrance === 'west' && x === cx - d.radiusX && dz === 0) ||
      (d.entrance === 'east' && x === cx + d.radiusX && dz === 0));
  if (entrance) return 0;
  if (x === cx && y === cy - 1 && z === cz) return 37;
  if (y === cy - 1 && dx === d.radiusX - 1 && dz === d.radiusZ - 1) return 38;
  return boundary ? 17 : 0;
}
export const dungeonLoot = (seed: number, id: string, index: number) => {
  const h = [...id].reduce((v, c) => Math.imul(v ^ c.charCodeAt(0), 16777619) >>> 0, seed ^ index);
  const pool = ['bread', 'iron-ingot', 'wheat', 'bucket', 'saddle'] as const;
  return Object.freeze([{ itemId: pool[h % pool.length], count: 1 + (h % 3) }]);
};
