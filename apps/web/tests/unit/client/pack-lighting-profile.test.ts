import { describe, expect, it } from 'vitest';
import {
  parsePackLightingProfile,
  type PackLightingProfile,
} from '../../../src/client/presentation/pack-lighting-profile';

const frame = (hour: number, top = [0.1, 0.2, 0.3]) => ({
  hour,
  top,
  horizon: [0.2, 0.3, 0.4],
  fog: [0.1, 0.1, 0.1],
  ambient: [0.2, 0.2, 0.2],
  sun: [0.4, 0.4, 0.4],
  intensity: 0.5,
  skyRadiance: [0.2, 0.3, 0.4],
});
const valid = (): PackLightingProfile => ({
  schemaVersion: 1,
  blockLightTint: [1, 0.8, 0.6],
  surfaceSelfEmission: { 'sample:lamp': { color: [2, 1, 0.5], intensity: 2 } },
  environmentKeyframes: [frame(0), frame(24)],
  toneMapper: 'linear',
  exposure: 1,
});

describe('Pack lighting profile parser', () => {
  it('accepts a closed profile and freezes parsed data', () => {
    const result = parsePackLightingProfile(valid());
    expect(result.schemaVersion).toBe(1);
    expect(Object.isFrozen(result.environmentKeyframes[0].top)).toBe(true);
  });

  it.each([
    ['unknown field', { ...valid(), extra: true }],
    ['non-finite value', { ...valid(), exposure: Number.NaN }],
    [
      'composed self-emission exceeds the common sample bound',
      {
        ...valid(),
        surfaceSelfEmission: { 'sample:lamp': { color: [16, 0, 0], intensity: 2 } },
      },
    ],
    ['bad normalized color', { ...valid(), environmentKeyframes: [frame(0, [1.1, 0, 0]), frame(24, [1.1, 0, 0])] }],
    ['non-increasing hours', { ...valid(), environmentKeyframes: [frame(0), frame(0)] }],
    ['open cycle', { ...valid(), environmentKeyframes: [frame(0), frame(24, [0.4, 0.2, 0.1])] }],
    ['invalid mapper', { ...valid(), toneMapper: 'filmic' }],
    [
      'missing field',
      (() => {
        const value = valid() as unknown as Record<string, unknown>;
        delete value.exposure;
        return value;
      })(),
    ],
  ])('rejects %s', (_label, input) => expect(() => parsePackLightingProfile(input)).toThrow(TypeError));

  it('rejects poisoned prototypes, non-plain objects and extra RGB channels', () => {
    const polluted = Object.assign(Object.create({ inherited: true }), valid());
    expect(() => parsePackLightingProfile(polluted)).toThrow(TypeError);
    expect(() => parsePackLightingProfile({ ...valid(), blockLightTint: [1, 1, 1, 1] })).toThrow(TypeError);
    expect(() => parsePackLightingProfile({ ...valid(), surfaceSelfEmission: new Map() })).toThrow(TypeError);
  });
});
