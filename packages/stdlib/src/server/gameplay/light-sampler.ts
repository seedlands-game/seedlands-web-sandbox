import { Voxel, isSolid } from '../../world/voxel';
export type LightPosition = [number, number, number];
const emission = (voxel: number) =>
  voxel === Voxel.Glowstone
    ? 15
    : voxel === Voxel.Lantern
      ? 14
      : voxel === Voxel.Fire
        ? 15
        : voxel === Voxel.Lava
          ? 15
          : 0;
export const daylightLevel = (worldTime: number) => {
  if (!Number.isFinite(worldTime)) throw new TypeError('World time must be finite.');
  const hour = ((worldTime % 24) + 24) % 24;
  const elevation = Math.sin(((hour - 6) / 24) * Math.PI * 2);
  return Math.max(0, Math.min(15, Math.round((elevation * 0.8 + 0.2) * 15)));
};
export function sampleLight(
  position: LightPosition,
  worldTime: number,
  getVoxel: (position: LightPosition) => number | undefined,
) {
  const [x, y, z] = position;
  let sky = daylightLevel(worldTime);
  for (let above = y + 1; above < 64; above++) {
    const voxel = getVoxel([x, above, z]);
    if (voxel === undefined) return null;
    if (isSolid(voxel)) {
      sky = 0;
      break;
    }
  }
  let block = 0;
  const radius = 15;
  for (let dx = -radius; dx <= radius; dx++)
    for (let dy = -radius; dy <= radius; dy++)
      for (let dz = -radius; dz <= radius; dz++) {
        const distance = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
        if (distance > radius) continue;
        const voxel = getVoxel([x + dx, y + dy, z + dz]);
        if (voxel === undefined) continue;
        block = Math.max(block, emission(voxel) - distance);
      }
  return Object.freeze({ sky, block, level: Math.max(sky, block) });
}
