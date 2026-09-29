import { describe, expect, it } from 'vitest';
import { voxelAdjacentFacePoint } from '../../src/server/gameplay/gameplay-geometry';

describe('gameplay geometry', () => {
  it.each([
    [
      [2, 3, 4],
      [3, 3, 4],
      [3.000001, 3.5, 4.5],
    ],
    [
      [2, 3, 4],
      [1, 3, 4],
      [1.999999, 3.5, 4.5],
    ],
    [
      [2, 3, 4],
      [2, 4, 4],
      [2.5, 4.000001, 4.5],
    ],
    [
      [2, 3, 4],
      [2, 2, 4],
      [2.5, 2.999999, 4.5],
    ],
    [
      [2, 3, 4],
      [2, 3, 5],
      [2.5, 3.5, 5.000001],
    ],
    [
      [2, 3, 4],
      [2, 3, 3],
      [2.5, 3.5, 3.999999],
    ],
  ] as const)('returns the adjacent-side interior point for %j -> %j', (hit, adjacent, expected) => {
    const point = voxelAdjacentFacePoint(hit, adjacent);
    expected.forEach((coordinate, axis) => expect(point[axis]).toBeCloseTo(coordinate, 12));
  });
});
