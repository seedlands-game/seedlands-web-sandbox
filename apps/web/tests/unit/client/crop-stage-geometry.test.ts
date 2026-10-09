import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '@seedlands/stdlib/world/voxel';
import { buildCropStageGeometry } from '../../../src/client/presentation/crop-stage-geometry';

describe('Pack-sized crop stage geometry', () => {
  it('emits two crossed quads with eight vertices, twelve indices, finite normals and UVs', () => {
    const geometry = buildCropStageGeometry({
      positions: [[0, 0, 0]],
      origin: [0, 0, 0],
      height: 0.75,
      width: 0.4,
    });

    expect(geometry.positions).toBeInstanceOf(Float32Array);
    expect(geometry.normals).toBeInstanceOf(Float32Array);
    expect(geometry.uvs).toBeInstanceOf(Float32Array);
    expect(geometry.indices).toBeInstanceOf(Uint32Array);
    expect(geometry.positions).toHaveLength(8 * 3);
    expect(geometry.normals).toHaveLength(8 * 3);
    expect(geometry.uvs).toHaveLength(8 * 2);
    expect(geometry.indices).toHaveLength(12);
    expect([...geometry.indices].every((index) => index < 8)).toBe(true);
    expect([...geometry.positions, ...geometry.normals, ...geometry.uvs].every(Number.isFinite)).toBe(true);
    expect(
      Array.from({ length: 8 }, (_, index) => {
        const offset = index * 3;
        return Math.hypot(geometry.normals[offset]!, geometry.normals[offset + 1]!, geometry.normals[offset + 2]!);
      }).every((length) => Math.abs(length - 1) < 1e-5),
    ).toBe(true);
    expect([...geometry.uvs].every((uv) => uv >= 0 && uv <= 1)).toBe(true);

    const vertices = Array.from({ length: 8 }, (_, index) => [
      geometry.positions[index * 3]!,
      geometry.positions[index * 3 + 1]!,
      geometry.positions[index * 3 + 2]!,
    ]);
    expect(Math.min(...vertices.map(([, y]) => y!))).toBeCloseTo(1);
    expect(Math.max(...vertices.map(([, y]) => y!))).toBeCloseTo(1.75);
    const xz = new Set(vertices.map(([x, , z]) => `${x!.toFixed(3)},${z!.toFixed(3)}`));
    expect(xz).toEqual(new Set(['0.300,0.300', '0.300,0.700', '0.700,0.300', '0.700,0.700']));
  });

  it('uses Pack width and height and converts negative-world positions relative to their chunk origin', () => {
    const position: [number, number, number] = [-1, 2, -CHUNK_SIZE - 1];
    const geometry = buildCropStageGeometry({
      positions: [position],
      origin: [-CHUNK_SIZE, 0, -2 * CHUNK_SIZE],
      height: 1.25,
      width: 0.2,
    });
    const coordinates = Array.from({ length: 8 }, (_, index) => [
      geometry.positions[index * 3]!,
      geometry.positions[index * 3 + 1]!,
      geometry.positions[index * 3 + 2]!,
    ]);

    expect(Math.min(...coordinates.map(([, y]) => y!))).toBeCloseTo(3);
    expect(Math.max(...coordinates.map(([, y]) => y!))).toBeCloseTo(4.25);
    expect(Math.min(...coordinates.map(([x]) => x!))).toBeCloseTo(CHUNK_SIZE - 0.6);
    expect(Math.max(...coordinates.map(([x]) => x!))).toBeCloseTo(CHUNK_SIZE - 0.4);
    expect(Math.min(...coordinates.map(([, , z]) => z!))).toBeCloseTo(CHUNK_SIZE - 0.6);
    expect(Math.max(...coordinates.map(([, , z]) => z!))).toBeCloseTo(CHUNK_SIZE - 0.4);

    position[0] = 999;
    expect(Math.max(...coordinates.map(([x]) => x!))).toBeCloseTo(CHUNK_SIZE - 0.4);
  });

  it.each([
    ['zero width', { width: 0, height: 0.5 }],
    ['oversized height', { width: 0.5, height: 2.01 }],
    ['nonfinite width', { width: Number.NaN, height: 0.5 }],
  ])('rejects %s dimensions', (_label, dimensions) => {
    expect(() => buildCropStageGeometry({ positions: [[0, 0, 0]], origin: [0, 0, 0], ...dimensions })).toThrow();
  });
});
