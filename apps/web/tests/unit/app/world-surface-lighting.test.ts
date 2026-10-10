import { describe, expect, it } from 'vitest';
import {
  sampleWorldSurfaceLighting,
  createPresentedSurfaceLightingSampler,
  createWorldSurfaceLightingSampler,
} from '../../../src/app/scene/world-surface-lighting';
import { combineSurfaceLighting } from '../../../src/app/scene/surface-lighting';
const frame = { skyRadiance: [2, 1, 0.5] as const, blockLightTint: [0.25, 0.5, 1] as const };
const self = [0.2, 0.1, 0] as const;
describe('World表面采样同环境frame', () => {
  it('使用实际Sky visibility和0..15方块光，保存各自线性通道', () => {
    const sample = sampleWorldSurfaceLighting({ ready: true, visibility: 0.5 }, 15, frame, self);
    expect(sample.ready).toBe(true);
    expect(combineSurfaceLighting(sample)).toEqual({ receivedLighting: [1.25, 1, 1.25], selfEmission: self });
  });
  it.each(['sky', 'block', 'both'] as const)('%s未知时received归零而自发光不变', (unknown) => {
    const sample = sampleWorldSurfaceLighting(
      unknown === 'block' ? { ready: true, visibility: 1 } : null,
      unknown === 'sky' ? 15 : null,
      frame,
      self,
    );
    expect(sample.ready).toBe(false);
    expect(combineSurfaceLighting(sample)).toEqual({ receivedLighting: [0, 0, 0], selfEmission: self });
  });
  it('恢复/缺presentation时使用当前world/frame，拒绝保存旧owner采样', () => {
    const day = createWorldSurfaceLightingSampler(
      { sample: () => ({ ready: true, visibility: 1 }) },
      { sampleKnown: () => 0 },
    );
    const dark = createWorldSurfaceLightingSampler({ sample: () => null }, { sampleKnown: () => 15 });
    let current: { sampleSurfaceLighting: typeof day } | null = { sampleSurfaceLighting: day };
    const sample = createPresentedSurfaceLightingSampler(() => [current, frame]);
    expect(combineSurfaceLighting(sample([0, 60, 0], self)).receivedLighting).toEqual(frame.skyRadiance);
    current = { sampleSurfaceLighting: dark };
    expect(sample([0, 60, 0], self).ready).toBe(false);
    current = null;
    expect(combineSurfaceLighting(sample([0, 60, 0], self))).toEqual({
      receivedLighting: [0, 0, 0],
      selfEmission: self,
    });
  });
  it('已证明遮蔽/已知零光与unknown区分', () => {
    expect(sampleWorldSurfaceLighting({ ready: true, visibility: 0 }, 0, frame, self).ready).toBe(true);
    expect(sampleWorldSurfaceLighting({ ready: false, visibility: 1 }, 15, frame, self).ready).toBe(false);
  });
});
