import { Voxel } from './voxel';

type WaterSampler = {
  getVoxel: (x: number, y: number, z: number) => number;
  getFluidLevel: (x: number, y: number, z: number) => number | null;
};

const neighbors = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export function sampleWaterFlowDirection(
  x: number,
  y: number,
  z: number,
  sampler: WaterSampler,
): readonly [number, number] {
  if (sampler.getVoxel(x, y, z) !== Voxel.Water) return [0, 0];
  const level = sampler.getFluidLevel(x, y, z) ?? 8;
  let flowX = 0;
  let flowZ = 0;
  for (const [dx, dz] of neighbors) {
    const voxel = sampler.getVoxel(x + dx, y, z + dz);
    const targetLevel = voxel === Voxel.Water ? (sampler.getFluidLevel(x + dx, y, z + dz) ?? 8) : 0;
    const drop = Math.max(0, level - targetLevel);
    flowX += dx * drop;
    flowZ += dz * drop;
  }
  const length = Math.hypot(flowX, flowZ);
  return length > 0.001 ? [flowX / length, flowZ / length] : [0, 0];
}
