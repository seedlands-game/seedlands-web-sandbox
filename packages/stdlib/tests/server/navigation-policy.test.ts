import { describe, expect, it } from 'vitest';
import {
  NAVIGATION_ITEMS_CAPABILITY,
  freezeNavigationPolicy,
  type NavigationItemsPolicyV1,
} from '../../src/server/gameplay/modules/navigation-policy';

const validPolicy = () => ({
  version: 1 as const,
  mapItemId: 'sample:map',
  compassItemId: 'sample:compass',
  clockItemId: 'sample:clock',
  windowRadius: 4,
  sampleYOffset: -64,
  fallbackColor: 15,
  palette: [
    { voxel: 99, color: 3 },
    { voxel: 2, color: 1 },
  ],
});

const expectInvalid = (value: unknown) =>
  expect(() => freezeNavigationPolicy(value as NavigationItemsPolicyV1)).toThrow();

describe('navigation policy', () => {
  it('exports the stable capability and returns a canonical detached deep-frozen policy', () => {
    expect(NAVIGATION_ITEMS_CAPABILITY).toBe('seedlands:navigation-items');
    const source = validPolicy();
    const frozen = freezeNavigationPolicy(source);

    expect(frozen).toEqual({
      version: 1,
      mapItemId: 'sample:map',
      compassItemId: 'sample:compass',
      clockItemId: 'sample:clock',
      windowRadius: 4,
      sampleYOffset: -64,
      fallbackColor: 15,
      palette: [
        { voxel: 2, color: 1 },
        { voxel: 99, color: 3 },
      ],
    });
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.palette)).toBe(true);
    expect(frozen.palette.every(Object.isFrozen)).toBe(true);
    const reversedInput = validPolicy();
    reversedInput.palette.reverse();
    expect(freezeNavigationPolicy(reversedInput)).toEqual(frozen);

    source.mapItemId = 'sample:changed';
    source.palette[0]!.voxel = 500;
    expect(frozen.mapItemId).toBe('sample:map');
    expect(frozen.palette).toEqual([
      { voxel: 2, color: 1 },
      { voxel: 99, color: 3 },
    ]);
  });

  it('requires version one, three non-empty distinct item IDs, and in-range policy bounds', () => {
    const invalids: unknown[] = [
      { ...validPolicy(), version: 2 },
      { ...validPolicy(), mapItemId: '' },
      { ...validPolicy(), compassItemId: '   ' },
      { ...validPolicy(), clockItemId: 'sample:map' },
      { ...validPolicy(), windowRadius: -1 },
      { ...validPolicy(), windowRadius: 5 },
      { ...validPolicy(), windowRadius: 1.5 },
      { ...validPolicy(), sampleYOffset: -65 },
      { ...validPolicy(), sampleYOffset: 65 },
      { ...validPolicy(), sampleYOffset: 0.5 },
      { ...validPolicy(), fallbackColor: -1 },
      { ...validPolicy(), fallbackColor: 16 },
      { ...validPolicy(), fallbackColor: 1.5 },
    ];
    invalids.forEach(expectInvalid);
  });

  it('requires unique 16-bit voxel palette entries with valid 4-bit colors', () => {
    const sparsePalette = new Array<{ voxel: number; color: number }>(2);
    sparsePalette[1] = { voxel: 2, color: 1 };
    const invalids: unknown[] = [
      { ...validPolicy(), palette: null },
      { ...validPolicy(), palette: sparsePalette },
      { ...validPolicy(), palette: Array.from({ length: 65_537 }, (_, voxel) => ({ voxel, color: 0 })) },
      { ...validPolicy(), palette: [{ voxel: -1, color: 0 }] },
      { ...validPolicy(), palette: [{ voxel: 65_536, color: 0 }] },
      { ...validPolicy(), palette: [{ voxel: 1.5, color: 0 }] },
      { ...validPolicy(), palette: [{ voxel: 1, color: -1 }] },
      { ...validPolicy(), palette: [{ voxel: 1, color: 16 }] },
      { ...validPolicy(), palette: [{ voxel: 1, color: 1.5 }] },
      {
        ...validPolicy(),
        palette: [
          { voxel: 1, color: 2 },
          { voxel: 1, color: 3 },
        ],
      },
    ];
    invalids.forEach(expectInvalid);
  });
});
