import { describe, expect, it } from 'vitest';
import {
  LogicTerrain,
  terrainOccupancyIndex,
  validateTerrainWindows,
} from '../../../packages/game-core/src/server/logic/logic-terrain';
import type { LogicPosition, TerrainWindow } from '../../../packages/game-core/src/server/logic/logic-protocol';

const window = (key: string, origin: LogicPosition, size: LogicPosition): TerrainWindow => ({
  key,
  chunkRevision: 1,
  origin,
  size,
  occupancy: new Uint8Array(size[0] * size[1] * size[2]),
});

const solid = (terrain: TerrainWindow, x: number, y: number, z: number) => {
  terrain.occupancy[
    terrainOccupancyIndex(terrain.size, x - terrain.origin[0], y - terrain.origin[1], z - terrain.origin[2])
  ] = 1;
};

const floor = (terrain: TerrainWindow) => {
  for (let z = terrain.origin[2]; z < terrain.origin[2] + terrain.size[2]; z += 1)
    for (let x = terrain.origin[0]; x < terrain.origin[0] + terrain.size[0]; x += 1)
      solid(terrain, x, terrain.origin[1], z);
};

describe('LogicTerrain', () => {
  it('rejects an observation whose non-overlapping windows exceed the frozen total cell budget', () => {
    expect(() =>
      validateTerrainWindows([window('left', [0, 0, 0], [32, 32, 32]), window('right', [32, 0, 0], [32, 32, 32])]),
    ).toThrow('Terrain windows exceed the total cell budget.');
  });

  it('accepts multiple non-overlapping windows that exactly fill the frozen total cell budget', () => {
    expect(() =>
      validateTerrainWindows([window('left', [0, 0, 0], [16, 32, 32]), window('right', [16, 0, 0], [16, 32, 32])]),
    ).not.toThrow();
  });

  it('moves toward a point in the same resolved cell instead of returning a zero wish', () => {
    const terrain = window('near', [0, 0, 0], [8, 5, 8]);
    floor(terrain);

    const step = new LogicTerrain([terrain]).nextStep('player', [2.1, 1, 2.1], [2.9, 1, 2.9]);
    expect(step?.wish.x).toBeCloseTo(Math.SQRT1_2);
    expect(step?.wish.z).toBeCloseTo(Math.SQRT1_2);
    expect(step?.jumpRequested).toBe(false);
  });

  it('does not request an upward step when the registered body cannot clear its current headroom', () => {
    const terrain = window('step', [2, 0, 2], [2, 5, 1]);
    floor(terrain);
    solid(terrain, 3, 1, 2);
    solid(terrain, 2, 3, 2);

    expect(new LogicTerrain([terrain]).nextStep('player', [2.5, 1, 2.5], [3.5, 2, 2.5])).toBeNull();
  });
});
