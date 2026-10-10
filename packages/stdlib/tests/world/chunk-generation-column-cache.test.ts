import { describe, expect, it, vi } from 'vitest';
import { makeChunk } from '../../src/world/chunk-generation';
import { macroAt, type MacroContext } from '../../src/world/macro-world';
import { createTreeColumnSampler } from '../../src/world/tree-generation';
import { baseVoxel, CHUNK_SIZE, voxelIndex } from '../../src/world/voxel';

function pointSampledChunk(seed: number, cx: number, cy: number, cz: number, version: number) {
  const columns = new Map<string, MacroContext>();
  const query = (x: number, z: number) => {
    const key = `${x},${z}`;
    let context = columns.get(key);
    if (!context) {
      context = macroAt(seed, x, z, version);
      columns.set(key, context);
    }
    return context;
  };
  const result = new Uint16Array(CHUNK_SIZE ** 3);
  for (let z = 0; z < CHUNK_SIZE; z++)
    for (let x = 0; x < CHUNK_SIZE; x++)
      for (let y = 0; y < CHUNK_SIZE; y++) {
        const wx = cx * CHUNK_SIZE + x;
        const wy = cy * CHUNK_SIZE + y;
        const wz = cz * CHUNK_SIZE + z;
        result[voxelIndex(x, y, z)] = baseVoxel(seed, wx, wy, wz, query(wx, wz), query, version);
      }
  return result;
}

describe('chunk generation column tree candidates', () => {
  it('reads each anchor once and preserves first-match precedence for overlapping trees', () => {
    const origin = vi.fn((x: number, z: number) => (x === -1 && z === 0 ? 15 : x === 0 && z === 0 ? 18 : null));
    const sample = createTreeColumnSampler(0, 0, 11, origin);
    expect(sample(19)).toBe(5);
    expect(sample(23)).toBe(4);
    for (let y = -32; y <= 160; y++) sample(y);
    expect(origin).toHaveBeenCalledTimes(49);
    expect(origin.mock.calls[0]).toEqual([-3, -3]);
    expect(origin.mock.calls[48]).toEqual([3, 3]);
  });

  it.each(Array.from({ length: 10 }, (_, index) => index + 2))(
    'matches every canonical voxel against point sampling for generator %i',
    (version) => {
      const seed = 1837 + version;
      const cx = version % 2 === 0 ? -1 : 0;
      const cy = version % 3 === 0 ? 1 : 0;
      const cz = version % 2 === 0 ? 0 : -1;
      expect(makeChunk(seed, cx, cy, cz, [], version)).toEqual(pointSampledChunk(seed, cx, cy, cz, version));
    },
  );

  it.each([-1, 4])('keeps below-ground and high-altitude chunks equivalent at cy=%i', (cy) => {
    expect(makeChunk(2726385568, -1, cy, -1, [], 11)).toEqual(pointSampledChunk(2726385568, -1, cy, -1, 11));
  });

  it('keeps negative-coordinate edits in order and excludes edits in other chunks', () => {
    const expected = pointSampledChunk(2, -1, 1, -1, 11);
    expected[voxelIndex(31, 0, 31)] = 3;
    const actual = makeChunk(
      2,
      -1,
      1,
      -1,
      [
        [-1, 32, -1, 4],
        [-1, 32, -1, 3],
        [0, 32, -1, 5],
      ],
      11,
    );
    expect(actual).toEqual(expected);
  });
});
