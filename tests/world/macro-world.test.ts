import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, floorDiv, normalizeSeed } from '../../src/world/voxel';
import { macroAt, macroSignature, riverDescriptorsNear } from '../../src/world/macro-world';

const seed = normalizeSeed('macro-world-vitest');

describe('Macro world generation', () => {
  it('is independent of query order and distinct across seeds', () => {
    const points = Array.from(
      { length: 81 },
      (_, index) => [((index % 9) - 4) * 192, (Math.floor(index / 9) - 4) * 192] as const,
    );
    const signature = macroSignature(seed, points);

    expect(macroSignature(seed, [...points].reverse())).toBe(signature);
    expect(macroSignature(normalizeSeed('macro-world-other'), points)).not.toBe(signature);
  });

  it('keeps adjacent terrain and climate samples continuous across chunk boundaries', () => {
    for (const [x, z] of [
      [31, 73],
      [255, -91],
      [-1, 255],
      [-257, -257],
    ]) {
      const current = macroAt(seed, x, z);
      const nextX = macroAt(seed, x + 1, z);
      const nextZ = macroAt(seed, x, z + 1);

      expect(Math.abs(current.terrainHeight - nextX.terrainHeight)).toBeLessThanOrEqual(5);
      expect(Math.abs(current.terrainHeight - nextZ.terrainHeight)).toBeLessThanOrEqual(5);
      expect(Math.abs(current.temperature - nextX.temperature)).toBeLessThan(0.03);
      expect(Math.abs(current.humidity - nextZ.humidity)).toBeLessThan(0.03);
    }
  });

  it('preserves a generated river identifier while crossing a chunk boundary', () => {
    let crossingRiverId: string | undefined;
    for (let x = -1536; x <= 1536 && !crossingRiverId; x += 384) {
      for (let z = -1536; z <= 1536 && !crossingRiverId; z += 384) {
        for (const river of riverDescriptorsNear(seed, x, z)) {
          for (let index = 1; index < river.path.length; index += 1) {
            const [ax, az] = river.path[index - 1];
            const [bx, bz] = river.path[index];
            const crossesX = floorDiv(ax, CHUNK_SIZE) !== floorDiv(bx, CHUNK_SIZE);
            const crossesZ = floorDiv(az, CHUNK_SIZE) !== floorDiv(bz, CHUNK_SIZE);
            if (!crossesX && !crossesZ) continue;
            const axis = crossesX ? 0 : 1;
            const start = axis === 0 ? ax : az;
            const end = axis === 0 ? bx : bz;
            const boundary = (floorDiv(Math.min(start, end), CHUNK_SIZE) + 1) * CHUNK_SIZE;
            const t = (boundary - start) / (end - start);
            if (t <= 0 || t >= 1) continue;
            const crossX = ax + (bx - ax) * t;
            const crossZ = az + (bz - az) * t;
            const before = axis === 0 ? macroAt(seed, boundary - 0.25, crossZ) : macroAt(seed, crossX, boundary - 0.25);
            const after = axis === 0 ? macroAt(seed, boundary + 0.25, crossZ) : macroAt(seed, crossX, boundary + 0.25);
            if (before.hydrology.id === river.id && after.hydrology.id === river.id) {
              crossingRiverId = river.id;
              break;
            }
          }
        }
      }
    }

    expect(crossingRiverId).toMatch(/^river:/);
  });
});
