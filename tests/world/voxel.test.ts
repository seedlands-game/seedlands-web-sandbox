import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE,
  Voxel,
  baseVoxel,
  chunkKey,
  floorDiv,
  isSolid,
  mod,
  normalizeSeed,
  voxelIndex,
} from '../../src/world/voxel';

describe('voxel coordinates and registry', () => {
  it('keeps the chunk size and occupancy contract stable', () => {
    expect(CHUNK_SIZE).toBe(32);
    expect(isSolid(Voxel.Air)).toBe(false);
    expect(isSolid(Voxel.Stone)).toBe(true);
  });

  it.each([-65, -33, -32, -1, 0, 1, 31, 32, 65])('round-trips world coordinate %i through its chunk', (coordinate) => {
    const chunk = floorDiv(coordinate, CHUNK_SIZE);
    const local = mod(coordinate, CHUNK_SIZE);

    expect(local).toBeGreaterThanOrEqual(0);
    expect(local).toBeLessThan(CHUNK_SIZE);
    expect(chunk * CHUNK_SIZE + local).toBe(coordinate);
  });

  it('keeps voxel indices and signed chunk keys stable', () => {
    expect(voxelIndex(0, 0, 0)).toBe(0);
    expect(voxelIndex(31, 31, 31)).toBe(CHUNK_SIZE ** 3 - 1);
    expect(chunkKey(-1, 0, 2)).toBe('-1,0,2');
  });
});

describe('procedural voxel generation', () => {
  it('normalizes seeds deterministically', () => {
    expect(normalizeSeed('seedlands')).toBe(normalizeSeed('seedlands'));
    expect(normalizeSeed('seedlands-a')).not.toBe(normalizeSeed('seedlands-b'));
  });

  it('is independent of sampling order', () => {
    const seed = normalizeSeed('vitest-determinism');
    const points = Array.from({ length: 49 }, (_, index) => [index - 24, (index * 11) % 40, 24 - index] as const);
    const firstPass = new Map(points.map(([x, y, z]) => [`${x},${y},${z}`, baseVoxel(seed, x, y, z)]));

    for (const [x, y, z] of [...points].reverse()) {
      expect(baseVoxel(seed, x, y, z)).toBe(firstPass.get(`${x},${y},${z}`));
    }
  });
});
