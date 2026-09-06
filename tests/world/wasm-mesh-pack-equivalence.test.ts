import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { createMeshPackKernel, runMeshPackKernel } from '../../src/compute/mesh-pack-kernel';
import { createMeshPackControlMemory, runMeshPackControl } from '../../src/compute/mesh-pack-kernel-control';
import { createKernelMemory } from '../../src/compute/kernel-memory';
import { batchMeshData, compactMeshData, type MeshData, type RenderCategory } from '../../src/world/mesh';

const wasmPath = new URL('../../src/generated/wasm/seedlands-kernels.wasm', import.meta.url);

const part = (renderCategory: RenderCategory, material: number, vertexCount: number, indices: number[]): MeshData => {
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Uint8Array(vertexCount * 4);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    positions.set([vertex + 0.25, -0, Number.MIN_VALUE], vertex * 3);
    normals.set([0, 1, 0], vertex * 3);
    uvs.set(
      [vertex % 3 === 0 ? Number.NaN : vertex === 1 ? Infinity : vertex === 2 ? -Infinity : 1.5, -Number.MIN_VALUE],
      vertex * 2,
    );
    colors.set([12 + vertex, 34 + vertex, 56 + vertex, 255], vertex * 4);
  }
  return {
    material: material as MeshData['material'],
    renderCategory,
    layout: 'float32',
    positions,
    normals,
    uvs,
    colors,
    indices: new Uint32Array(indices),
  };
};

describe('W06 MoonBit mesh packing equivalence', () => {
  it('keeps TS batching as the control and matches compact UV/color/index bytes', async () => {
    const parts = [
      part('transparent', 10, 4, [0, 1, 2, 0, 2, 3]),
      part('opaque', 2, 4, [0, 1, 2, 0, 2, 3]),
      part('emissive', 13, 4, [0, 1, 2, 0, 2, 3]),
      part('cutout', 8, 4, [0, 1, 2, 0, 2, 3]),
      part('opaque', 3, 2, [65_535, 65_536]),
    ];
    const expected = batchMeshData(parts).map(compactMeshData);
    const kernel = createMeshPackKernel(await createKernelMemory(await readFile(wasmPath)));
    const actual = runMeshPackKernel(kernel, parts);
    const control = runMeshPackControl(createMeshPackControlMemory(), parts);

    expect(actual.map((mesh) => mesh.renderCategory)).toEqual(['opaque', 'cutout', 'emissive', 'transparent']);
    expect(actual).toHaveLength(expected.length);
    expect(control).toHaveLength(actual.length);
    for (let index = 0; index < expected.length; index += 1) {
      expect(actual[index].layout).toBe('compact');
      expect(actual[index].material).toBe(null);
      expect(actual[index].positions).toEqual(expected[index].positions);
      expect(actual[index].normals).toEqual(expected[index].normals);
      expect(actual[index].uvs).toEqual(expected[index].uvs);
      expect(actual[index].colors).toEqual(expected[index].colors);
      expect(actual[index].indices).toEqual(expected[index].indices);
      expect(actual[index].positions).toEqual(control[index].positions);
      expect(actual[index].normals).toEqual(control[index].normals);
      expect(actual[index].uvs).toEqual(control[index].uvs);
      expect(actual[index].colors).toEqual(control[index].colors);
      expect(actual[index].indices).toEqual(control[index].indices);
    }
    expect(actual.find((mesh) => mesh.renderCategory === 'opaque')?.indices).toBeInstanceOf(Uint32Array);
    expect(kernel.failed).toBe(false);
  }, 30000);

  it('fails closed when the Wasm compact conversion is unavailable', async () => {
    const kernel = createMeshPackKernel(await createKernelMemory(await readFile(wasmPath)));
    const original = kernel.compactUvs;
    kernel.compactUvs = () => {
      throw new Error('forced mesh pack failure');
    };
    expect(() => runMeshPackKernel(kernel, [part('opaque', 2, 4, [0, 1, 2])])).toThrow(/forced mesh pack failure/);
    expect(kernel.failed).toBe(true);
    kernel.compactUvs = original;
  });
});
