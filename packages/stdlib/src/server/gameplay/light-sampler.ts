import { voxelLightCost, buildBlockLightVolume, sampleBlockLight } from '../../world/voxel-light';
import type { VoxelSemanticsResolver } from '../../world/voxel-semantics';
export type LightPosition = [number, number, number];
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
  semantics?: VoxelSemanticsResolver,
) {
  const [x, y, z] = position;
  let sky = daylightLevel(worldTime);
  for (let above = y + 1; above < 64; above++) {
    const voxel = getVoxel([x, above, z]);
    if (voxel === undefined) return null;
    if (voxelLightCost(voxel, semantics) >= 16) {
      sky = 0;
      break;
    }
  }
  const volume = buildBlockLightVolume(31, [x - 15, y - 15, z - 15], (px, py, pz) => getVoxel([px, py, pz]), semantics);
  const block = sampleBlockLight(volume, x, y, z);
  return Object.freeze({ sky, block, level: Math.max(sky, block) });
}
