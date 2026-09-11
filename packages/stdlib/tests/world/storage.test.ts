import { describe, expect, it } from 'vitest';
import { GENERATOR_VERSION, Voxel } from '../../src/world/voxel';
import { decodeWorldSave, encodeWorldSave, type WorldChange } from '../../src/world/storage';

describe('world storage codec', () => {
  it('round-trips seed, version, player, and mutations', () => {
    const changes: WorldChange[] = [
      [-33, 20, 32, Voxel.Air],
      [32, 21, -1, Voxel.Wood],
    ];
    const encoded = encodeWorldSave('roundtrip-seed', [1.5, 34, -2], changes);

    expect(decodeWorldSave(encoded)).toEqual({
      seed: 'roundtrip-seed',
      generatorVersion: GENERATOR_VERSION,
      player: [1.5, 34, -2],
      changes,
    });
  });

  it.each([
    ['missing data', null],
    ['invalid JSON', '{'],
    [
      'an incompatible generator version',
      JSON.stringify({ seed: 'seed', generatorVersion: 0, player: [0, 0, 0], changes: [] }),
    ],
    [
      'a malformed player',
      JSON.stringify({ seed: 'seed', generatorVersion: GENERATOR_VERSION, player: [0, 0], changes: [] }),
    ],
    [
      'a non-integer mutation',
      JSON.stringify({
        seed: 'seed',
        generatorVersion: GENERATOR_VERSION,
        player: [0, 0, 0],
        changes: [[0, 0, 0, 1.5]],
      }),
    ],
  ])('rejects %s', (_caseName, raw) => {
    expect(decodeWorldSave(raw)).toBeNull();
  });
});
