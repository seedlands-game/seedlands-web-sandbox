import { describe, expect, it } from 'vitest';
import { overworldVoxelSemantics } from '../src/blocks';

describe('Classic legacy voxel light semantics', () => {
  it('preserves every non-default emission and light-cost value in storage IDs 0 through 88', () => {
    const legacy = overworldVoxelSemantics
      .filter(({ storageId }) => storageId <= 88)
      .sort((left, right) => left.storageId - right.storageId);

    expect(legacy.map(({ storageId }) => storageId)).toEqual(Array.from({ length: 89 }, (_, storageId) => storageId));
    expect(
      legacy.filter(({ emission }) => emission !== 0).map(({ storageId, emission }) => [storageId, emission]),
    ).toEqual([
      [9, 15],
      [10, 14],
      [27, 15],
      [29, 15],
      [54, 14],
      [69, 15],
      [71, 13],
      [73, 9],
    ]);
    expect(
      legacy.filter(({ lightCost }) => lightCost !== 16).map(({ storageId, lightCost }) => [storageId, lightCost]),
    ).toEqual([
      [0, 1],
      [5, 2],
      [8, 2],
      [10, 1],
      [18, 1],
      [27, 1],
      [29, 1],
      [31, 1],
      [32, 1],
      [33, 1],
      [34, 1],
      [35, 1],
      [37, 1],
      [39, 1],
      [40, 1],
      [41, 1],
      [46, 2],
      [49, 1],
      [50, 1],
      [51, 1],
      [53, 1],
      [54, 1],
      [55, 1],
      [56, 1],
      [57, 1],
      [58, 1],
      [59, 1],
      [61, 1],
      [62, 1],
    ]);
  });
});
