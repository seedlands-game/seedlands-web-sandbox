import { describe, expect, it, vi } from 'vitest';
import {
  sampleWorldSurfaceLighting,
  createPresentedSurfaceLightingSampler,
  createWorldSurfaceLightingSampler,
  type WorldSurfaceLightingSampler,
} from '../../../src/app/scene/world-surface-lighting';
import { combineSurfaceLighting } from '../../../src/app/scene/surface-lighting';
const frame = { skyRadiance: [2, 1, 0.5] as const, blockLightTint: [0.25, 0.5, 1] as const };
const self = [0.2, 0.1, 0] as const;
describe('World表面采样同环境frame', () => {
  it('reads one coherent sky/block source while retaining different material emission channels', () => {
    const sky = vi.fn(() => ({ ready: true, visibility: 0.5 }));
    const block = vi.fn(() => 15);
    const sample = createWorldSurfaceLightingSampler({ sample: sky }, { sampleKnown: block });
    const emissions = [self, [0, 2, 1] as const];
    const values = sample.batch!([1, 2, 3], frame, emissions);
    expect(sky).toHaveBeenCalledOnce();
    expect(block).toHaveBeenCalledOnce();
    expect(values.map(combineSurfaceLighting)).toEqual(
      emissions.map((selfEmission) => ({ receivedLighting: [1.25, 1, 1.25], selfEmission })),
    );
    expect(values[0]).not.toBe(values[1]);
    expect(emissions).toEqual([self, [0, 2, 1]]);
  });

  it('samples the replacement world/frame and fails dark immediately within each new batch', () => {
    const day = createWorldSurfaceLightingSampler(
      { sample: () => ({ ready: true, visibility: 1 }) },
      { sampleKnown: () => 0 },
    );
    const unknown = createWorldSurfaceLightingSampler({ sample: () => null }, { sampleKnown: () => 15 });
    let world: { sampleSurfaceLighting: typeof day } | null = { sampleSurfaceLighting: day };
    let currentFrame: Parameters<WorldSurfaceLightingSampler>[1] = frame;
    const current = vi.fn(() => [world, currentFrame] as const);
    const sample = createPresentedSurfaceLightingSampler(current);
    const emissions = [self, [1, 0, 0] as const];
    expect(sample.batch!([0, 60, 0], emissions).map(combineSurfaceLighting)).toEqual(
      emissions.map((selfEmission) => ({ receivedLighting: frame.skyRadiance, selfEmission })),
    );
    expect(current).toHaveBeenCalledOnce();
    world = { sampleSurfaceLighting: unknown };
    expect(sample.batch!([0, 60, 0], emissions).map(combineSurfaceLighting)).toEqual(
      emissions.map((selfEmission) => ({ receivedLighting: [0, 0, 0], selfEmission })),
    );
    world = { sampleSurfaceLighting: day };
    currentFrame = { skyRadiance: [0, 0, 0], blockLightTint: [0, 0, 0] };
    expect(sample.batch!([0, 60, 0], emissions).every((value) => value.ready)).toBe(true);
    expect(sample.batch!([0, 60, 0], emissions).map(combineSurfaceLighting)).toEqual(
      emissions.map((selfEmission) => ({ receivedLighting: [0, 0, 0], selfEmission })),
    );
    world = null;
    expect(sample.batch!([0, 60, 0], emissions).every((value) => !value.ready)).toBe(true);
  });

  it('preserves every legacy world callback and avoids source reads for an empty batch', () => {
    const legacy = vi.fn<WorldSurfaceLightingSampler>((_position, currentFrame, emission) =>
      sampleWorldSurfaceLighting({ ready: true, visibility: 0.5 }, 15, currentFrame, emission),
    );
    const current = vi.fn(() => [{ sampleSurfaceLighting: legacy }, frame] as const);
    const sample = createPresentedSurfaceLightingSampler(current);
    expect(sample.batch!([1, 2, 3], [self, [0, 1, 2]])).toHaveLength(2);
    expect(legacy.mock.calls).toEqual([
      [[1, 2, 3], frame, self],
      [[1, 2, 3], frame, [0, 1, 2]],
    ]);
    current.mockClear();
    legacy.mockClear();
    expect(sample.batch!([1, 2, 3], [])).toEqual([]);
    expect(current).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  it('preserves the legacy world method receiver in the batch fallback', () => {
    const world = {
      visibility: 0.5,
      sampleSurfaceLighting(...args: Parameters<WorldSurfaceLightingSampler>) {
        return sampleWorldSurfaceLighting({ ready: true, visibility: this.visibility }, 15, args[1], args[2]);
      },
    };
    const sample = createPresentedSurfaceLightingSampler(() => [world, frame]);
    expect(sample.batch!([1, 2, 3], [self, [0, 1, 2]]).map(combineSurfaceLighting)).toEqual([
      { receivedLighting: [1.25, 1, 1.25], selfEmission: self },
      { receivedLighting: [1.25, 1, 1.25], selfEmission: [0, 1, 2] },
    ]);
  });

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
