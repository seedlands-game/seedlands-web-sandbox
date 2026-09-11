import { describe, expect, it } from 'vitest';
import { EnvironmentPresentationClock } from '../../../src/client/presentation/environment-presentation-clock';
import { sunShadowOptions } from '../../../src/app/scene/sun-shadow-policy';
import {
  normalizeSunMotionSamples,
  normalizeSunMotionTailWindows,
  SUN_REFERENCE_DIRECTION_STEP_RADIANS,
  SUN_TAIL_DIRECTION_SUPPORT_RADIANS,
  type GroundSample,
} from '../../support/performance/sun-shadow-sampling';

describe('太阳表现连续性', () => {
  it('20Hz时刻阶跃之间仍逐帧前进，并保留相同总时刻与有界滞后', () => {
    const clock = new EnvironmentPresentationClock(14.93);
    let hour = 14.93;
    const rendered: number[] = [];
    for (let frame = 0; frame < 180; frame += 1) {
      if (frame % 3 === 0) hour += 0.002;
      rendered.push(clock.advance(hour, 1 / 60));
    }
    expect(rendered.every((value, index) => index === 0 || value > rendered[index - 1])).toBe(true);
    expect(Math.max(...rendered.slice(1).map((value, index) => value - rendered[index]))).toBeLessThan(0.001);
    expect(hour - rendered.at(-1)!).toBeLessThan(0.004);
    expect(rendered.at(-1)).toBeLessThanOrEqual(hour);
  });

  it('午夜向前连续，暂停和显式设时立即稳定，不追赶隐藏时间', () => {
    const clock = new EnvironmentPresentationClock(23.999);
    const nearMidnight = clock.advance(0.001, 1 / 60);
    expect(nearMidnight > 23.999 || nearMidnight < 0.001).toBe(true);
    clock.reset(9);
    expect(clock.advance(9, 1 / 60)).toBe(9);
    expect(clock.advance(9.002, 1 / 60, true)).toBe(9.002);
    expect(clock.advance(9.002, 60, true)).toBe(9.002);
    clock.reset(18);
    expect(clock.advance(18, 1 / 60)).toBe(18);
  });

  it('100倍速的延迟快照与午夜仍连续追随，长帧有界', () => {
    const a = new EnvironmentPresentationClock(14.93);
    const next = a.advance(15.53, 0.1);
    expect(next).toBeGreaterThan(14.93);
    expect(next).toBeLessThan(15.53);
    const b = new EnvironmentPresentationClock(14.93);
    expect(b.advance(15.53, 10)).toBe(next);
    const midnight = new EnvironmentPresentationClock(23.8);
    const wrapped = midnight.advance(0.4, 0.1);
    expect(wrapped).toBeGreaterThan(0);
    expect(wrapped).toBeLessThan(0.4);
  });

  it('同一输入间隔分片不改变一阶表现积分，拒绝非有限参数', () => {
    const a = new EnvironmentPresentationClock(12),
      b = new EnvironmentPresentationClock(12);
    const whole = a.advance(12.002, 1 / 30);
    b.advance(12.002, 1 / 60);
    expect(b.advance(12.002, 1 / 60)).toBeCloseTo(whole, 10);
    expect(() => a.advance(Number.NaN, 0.01)).toThrow();
    expect(() => a.advance(12, -1)).toThrow();
  });
});

describe('太阳阴影采样范围', () => {
  it('在同512纹理和58m范围中给近场分配更细采样，并混合级联边界', () => {
    const options = sunShadowOptions(512);
    expect(options.shadowResolution).toBe(512);
    expect(options.shadowDistance).toBe(58);
    expect(options.numCascades).toBeGreaterThan(1);
    expect(options.cascadeBlend).toBeGreaterThan(0);
    const fraction = 1 / options.numCascades;
    const firstFar =
      (0.05 + (58 - 0.05) * fraction) * (1 - options.cascadeDistribution) +
      0.05 * (58 / 0.05) ** fraction * options.cascadeDistribution;
    const farHalfHeight = Math.tan((36 * Math.PI) / 180) * firstFar;
    const radiusBound = Math.hypot((farHalfHeight * 16) / 9, farHalfHeight, firstFar / 2);
    expect((4 * radiusBound) / options.shadowResolution).toBeLessThan(0.15);
    expect(sunShadowOptions(0).castShadows).toBe(false);
    expect(sunShadowOptions(1024).shadowResolution).toBe(1024);
  });
  it('High 的更多纹理预算覆盖更远距离，近级保持相近世界采样尺度', () => {
    const firstFar = (resolution: 512 | 1024) => {
      const options = sunShadowOptions(resolution);
      const fraction = 1 / options.numCascades;
      return (
        ((0.05 + 57.95 * fraction) * (1 - options.cascadeDistribution) +
          0.05 * (58 / 0.05) ** fraction * options.cascadeDistribution) /
        resolution
      );
    };
    const ratio = firstFar(1024) / firstFar(512);
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.2);
  });
});

const referenceDirectionStep = SUN_REFERENCE_DIRECTION_STEP_RADIANS;
const sunMotionSample = (step: number, difference: number): GroundSample => ({
  rafAt: step * 16.667,
  readbackAndScanMs: 0,
  mean: 80,
  difference,
  changed: difference > 0 ? 0.02 : 0,
  error: 0,
  sunTime: 14.93 + step / 100,
  sunDirection: [Math.sin(step * referenceDirectionStep), 0, Math.cos(step * referenceDirectionStep)],
});
const maximumTailDifference = (samples: GroundSample[]) =>
  Math.max(...normalizeSunMotionTailWindows(samples).map((window) => window.normalizedDifference));

describe('太阳阴影固定角尾项门禁', () => {
  it('同一跳变被不同帧相位切分时保持同一尾项分数', () => {
    const onePair = [sunMotionSample(0, 0), sunMotionSample(2, 0.72)];
    const splitPairs = [sunMotionSample(0, 0), sunMotionSample(0.8, 0.48), sunMotionSample(2, 0.24)];

    expect(Math.max(...normalizeSunMotionSamples(onePair).map((value) => value.normalizedDifference!))).toBeCloseTo(
      0.36,
      8,
    );
    expect(Math.max(...normalizeSunMotionSamples(splitPairs).map((value) => value.normalizedDifference!))).toBeCloseTo(
      0.6,
      8,
    );
    expect(maximumTailDifference(onePair)).toBeCloseTo(0.36, 8);
    expect(maximumTailDifference(splitPairs)).toBeCloseTo(0.36, 8);
  });

  it('合成的不稳定负控制仍超过未改变的0.6门禁', () => {
    const unstable = [sunMotionSample(0, 0), sunMotionSample(0.9, 0.9), sunMotionSample(2, 0.7)];
    expect(maximumTailDifference(unstable)).toBeGreaterThan(0.6);
  });

  it('每个起点只取向前最短的完整支持窗，不计末尾不完整窗', () => {
    const samples = [
      sunMotionSample(0, 0),
      sunMotionSample(0.75, 0.1),
      sunMotionSample(1.2, 0.2),
      sunMotionSample(2.1, 0.3),
      sunMotionSample(3.15, 0.4),
    ];
    const windows = normalizeSunMotionTailWindows(samples, referenceDirectionStep, SUN_TAIL_DIRECTION_SUPPORT_RADIANS);

    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({ fromSampleIndex: 0, toSampleIndex: 3 });
    expect(windows[1]).toMatchObject({ fromSampleIndex: 1, toSampleIndex: 4 });
  });

  it('没有任何完整支持窗时fail closed', () => {
    expect(() => normalizeSunMotionTailWindows([sunMotionSample(0, 0), sunMotionSample(1.5, 0.2)])).toThrow(
      /完整尾项角支持窗/,
    );
  });
});
