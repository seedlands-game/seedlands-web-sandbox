import { describe, expect, it, vi } from 'vitest';
import {
  SURFACE_LIGHTING_MAX_RADIANCE,
  applySurfaceLightingToMaterial,
  combineSurfaceLighting,
  createSurfaceLightingSample,
  type SurfaceLightingChannels,
  type SurfaceLightingSampleInput,
} from '../../../src/app/scene/surface-lighting';

const readyInput = (): SurfaceLightingSampleInput => ({
  skyVisibility: 0.5,
  skyRadiance: [2, 4, 6],
  blockIrradiance: [1, 2, 3],
  selfEmission: [0.25, 0.5, 1],
});

describe('surface lighting model', () => {
  it('combines received light in linear space while keeping self-emission independent', () => {
    const channels = combineSurfaceLighting(createSurfaceLightingSample(readyInput()));

    expect(channels.receivedLighting).toEqual([2, 4, 6]);
    expect(channels.selfEmission).toEqual([0.25, 0.5, 1]);

    const brighterReceived = combineSurfaceLighting(
      createSurfaceLightingSample({
        ...readyInput(),
        skyVisibility: 1,
        blockIrradiance: [3, 3, 3],
      }),
    );
    expect(brighterReceived.receivedLighting).not.toEqual(channels.receivedLighting);
    expect(brighterReceived.selfEmission).toEqual(channels.selfEmission);
  });

  it.each([
    ['sky visibility', { ...readyInput(), skyVisibility: null }],
    ['sky radiance', { ...readyInput(), skyRadiance: null }],
    ['block irradiance', { ...readyInput(), blockIrradiance: null }],
  ] as const)('fails all received light dark when %s is unknown but preserves self-emission', (_label, input) => {
    const sample = createSurfaceLightingSample(input);
    expect(sample).toMatchObject({
      ready: false,
      skyVisibility: 0,
      skyRadiance: [0, 0, 0],
      blockIrradiance: [0, 0, 0],
      selfEmission: readyInput().selfEmission,
    });
    expect(combineSurfaceLighting(sample)).toEqual({
      receivedLighting: [0, 0, 0],
      selfEmission: readyInput().selfEmission,
    });
  });

  it('honors an unavailable discriminant when stale received-light channels remain nonzero', () => {
    const sample = {
      ready: false,
      skyVisibility: 1,
      skyRadiance: [8, 7, 6],
      blockIrradiance: [5, 4, 3],
      selfEmission: [0.25, 0.5, 1],
    } as unknown as Parameters<typeof combineSurfaceLighting>[0];

    expect(combineSurfaceLighting(sample)).toEqual({
      receivedLighting: [0, 0, 0],
      selfEmission: [0.25, 0.5, 1],
    });
  });

  it('rejects malformed stale channels even when the sample is unavailable', () => {
    const sample = {
      ready: false,
      skyVisibility: 0,
      skyRadiance: [Number.NaN, 0, 0],
      blockIrradiance: [0, 0, 0],
      selfEmission: [0, 0, 0],
    } as unknown as Parameters<typeof combineSurfaceLighting>[0];

    expect(() => combineSurfaceLighting(sample)).toThrow(/skyRadiance/);
  });

  it('rejects a malformed readiness discriminant', () => {
    expect(() =>
      combineSurfaceLighting({
        ...createSurfaceLightingSample(readyInput()),
        ready: undefined,
      } as unknown as Parameters<typeof combineSurfaceLighting>[0]),
    ).toThrow(/readiness/);
  });

  it.each([
    ['negative visibility', { ...readyInput(), skyVisibility: -0.01 }],
    ['visibility above one', { ...readyInput(), skyVisibility: 1.01 }],
    ['non-finite sky', { ...readyInput(), skyRadiance: [0, Number.NaN, 0] }],
    ['negative block light', { ...readyInput(), blockIrradiance: [0, -0.01, 0] }],
    [
      'invalid known light beside an unknown channel',
      { ...readyInput(), skyVisibility: null, blockIrradiance: [0, Number.POSITIVE_INFINITY, 0] },
    ],
    [
      'self-emission above the safety bound',
      { ...readyInput(), selfEmission: [0, 0, SURFACE_LIGHTING_MAX_RADIANCE + 1] },
    ],
    ['sparse RGB', { ...readyInput(), skyRadiance: Array(3) }],
  ] as const)('rejects %s instead of clamping malformed lighting', (_label, input) => {
    expect(() => createSurfaceLightingSample(input as SurfaceLightingSampleInput)).toThrow();
  });

  it('deep-freezes the sample and combined channel values', () => {
    const input = {
      skyVisibility: 0.5,
      skyRadiance: [2, 4, 6] as [number, number, number],
      blockIrradiance: [1, 2, 3] as [number, number, number],
      selfEmission: [0.25, 0.5, 1] as [number, number, number],
    };
    const sample = createSurfaceLightingSample(input);
    const channels = combineSurfaceLighting(sample);
    input.skyRadiance[0] = 12;
    input.blockIrradiance[0] = 12;
    input.selfEmission[0] = 12;

    expect(Object.isFrozen(sample)).toBe(true);
    expect(Object.isFrozen(sample.skyRadiance)).toBe(true);
    expect(Object.isFrozen(sample.blockIrradiance)).toBe(true);
    expect(Object.isFrozen(sample.selfEmission)).toBe(true);
    expect(Object.isFrozen(channels)).toBe(true);
    expect(Object.isFrozen(channels.receivedLighting)).toBe(true);
    expect(Object.isFrozen(channels.selfEmission)).toBe(true);
    expect(sample.skyRadiance).toEqual([2, 4, 6]);
    expect(sample.blockIrradiance).toEqual([1, 2, 3]);
    expect(sample.selfEmission).toEqual([0.25, 0.5, 1]);
  });

  it.each(['terrain', 'water', 'actor', 'world-item', 'viewmodel'] as const)(
    'applies the same channel contract to the future %s adapter',
    (consumer) => {
      const received = new Map<string, unknown>();
      const apply = vi.fn((channels: SurfaceLightingChannels) => received.set(consumer, channels));
      const channels = applySurfaceLightingToMaterial({ apply }, createSurfaceLightingSample(readyInput()));

      expect(apply).toHaveBeenCalledOnce();
      expect(apply).toHaveBeenCalledWith(channels);
      expect(received.get(consumer)).toBe(channels);
      expect(channels).toEqual({ receivedLighting: [2, 4, 6], selfEmission: [0.25, 0.5, 1] });
    },
  );
});
