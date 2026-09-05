import { describe, expect, it } from 'vitest';
import { sampleWaterImmersion } from '../../src/world/water-immersion';
import { Voxel } from '../../src/world/voxel';

const sample = (cameraY: number, levels: Record<number, number>, previousCameraSubmerged = false) =>
  sampleWaterImmersion({
    position: [0.5, cameraY, 0.5],
    feetOffset: 1.6,
    headOffset: 0.2,
    previousCameraSubmerged,
    getVoxel: (_x, y) => (levels[y] ? Voxel.Water : Voxel.Air),
    getFluidLevel: (_x, y) => levels[y] ?? null,
  });

describe('实际水面介质采样', () => {
  it('区分干地、浅水和深水游泳', () => {
    expect(sample(2.6, {})).toMatchObject({ wading: false, swimming: false, cameraSubmerged: false, bodyFraction: 0 });
    const shallow = sample(2.2, { 0: 8 });
    expect(shallow.wading).toBe(true);
    expect(shallow.swimming).toBe(false);
    expect(shallow.bodyFraction).toBeGreaterThan(0);
    const deep = sample(1.4, { 0: 8, 1: 8 });
    expect(deep.swimming).toBe(true);
    expect(deep.bodyFraction).toBeGreaterThan(0.6);
  });

  it('使用真实 fluid level 计算表面而不是把水当整格', () => {
    const low = sample(1.4, { 1: 2 });
    const full = sample(1.4, { 1: 8 });
    expect(low.waterSurfaceY).toBeCloseTo(1.25);
    expect(full.waterSurfaceY).toBeCloseTo(1.875);
    expect(full.bodyFraction).toBeGreaterThan(low.bodyFraction);
  });

  it('镜头入水和离水使用不同阈值避免贴面抖动', () => {
    expect(sample(1.82, { 1: 8 }, false).cameraSubmerged).toBe(false);
    expect(sample(1.76, { 1: 8 }, false).cameraSubmerged).toBe(true);
    expect(sample(1.91, { 1: 8 }, true).cameraSubmerged).toBe(true);
    expect(sample(1.96, { 1: 8 }, true).cameraSubmerged).toBe(false);
  });
});
