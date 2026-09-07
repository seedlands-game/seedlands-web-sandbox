import { compactMeshData } from '../../src/world/mesh';
import { KernelMemory } from '../../src/compute/kernel-memory';
import { MeshPackKernel } from '../../src/compute/mesh-pack-kernel';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const evidence = 'changes/2026-09-07-data-plane-adoption/evidence';
const INPUT = 68;
const OUTPUT = 8 * 1024 * 1024 + 4;

type PackExports = {
  memory: WebAssembly.Memory;
  compact_uvs: (input: number, output: number, count: number) => number;
  pack_color_alpha: (input: number, output: number, count: number, material: number) => number;
  offset_indices: (input: number, output: number, count: number, vertexOffset: number) => number;
};

const compactReference = (bits: number[]) =>
  Uint16Array.from(bits, (value) => {
    const sign = (value >>> 16) & 0x8000;
    const exponent = ((value >>> 23) & 0xff) - 127 + 15;
    const mantissa = value & 0x7fffff;
    return exponent <= 0 ? sign : exponent >= 31 ? sign | 0x7c00 : sign | (exponent << 10) | (mantissa >>> 13);
  });

const deterministicBits = (count: number) => {
  const bits = [
    0, 0x80000000, 1, 0x80000001, 0x387fffff, 0x38800000, 0x3f800000, 0x3f801fff, 0x3f802000, 0x477fe000, 0x47800000,
    0x7f800000, 0xff800000, 0x7fc00001, 0xffc00001,
  ];
  let state = 0x7f4a7c15;
  while (bits.length < count) {
    state = Math.imul(state, 1664525) + 1013904223;
    bits.push(state >>> 0);
  }
  return bits;
};

async function load(mode: 'scalar' | 'simd'): Promise<PackExports> {
  const { instance } = await WebAssembly.instantiate(await readFile(`${evidence}/kernels-${mode}.wasm`));
  return instance.exports as unknown as PackExports;
}

describe('W06 Rust scalar/SIMD mesh pack ABI', () => {
  it('starts RED until scalar and SIMD artifacts export the three pack kernels', async () => {
    for (const mode of ['scalar', 'simd'] as const) {
      const wasm = await load(mode);
      expect(wasm.compact_uvs).toBeTypeOf('function');
      expect(wasm.pack_color_alpha).toBeTypeOf('function');
      expect(wasm.offset_indices).toBeTypeOf('function');
    }
  });

  it('keeps scalar and SIMD UV, RGBA and index bytes bit-identical through tails', async () => {
    const bits = deterministicBits(4_099);
    const uvExpected = compactReference(bits);
    const colors = Uint8Array.from({ length: 17 * 4 }, (_, index) => (index * 37 + 19) & 0xff);
    const indices = Uint32Array.from([0, 1, 15, 65_535, 0x7fffffff, 0xffffffff, 3]);
    const expectedIndices = Uint32Array.from(indices, (value) => (value + 0x7fffffff) >>> 0);
    for (const mode of ['scalar', 'simd'] as const) {
      const wasm = await load(mode);
      new Uint32Array(wasm.memory.buffer, INPUT, bits.length).set(bits);
      expect(wasm.compact_uvs(INPUT, OUTPUT, bits.length)).toBe(0);
      expect(new Uint16Array(wasm.memory.buffer, OUTPUT, bits.length)).toEqual(uvExpected);

      new Uint8Array(wasm.memory.buffer, INPUT, colors.length).set(colors);
      expect(wasm.pack_color_alpha(INPUT, OUTPUT, colors.length / 4, 260)).toBe(0);
      const packed = new Uint8Array(wasm.memory.buffer, OUTPUT, colors.length);
      for (let index = 0; index < colors.length; index += 4) {
        expect(packed.slice(index, index + 3)).toEqual(colors.slice(index, index + 3));
        expect(packed[index + 3]).toBe(3);
      }

      new Uint32Array(wasm.memory.buffer, INPUT, indices.length).set(indices);
      expect(wasm.offset_indices(INPUT, OUTPUT, indices.length, 0x7fffffff) >>> 0).toBe(Math.max(...expectedIndices));
      expect(new Uint32Array(wasm.memory.buffer, OUTPUT, indices.length)).toEqual(expectedIndices);
    }
  });

  it('rejects type-misaligned and overlapping ranges without changing inputs', async () => {
    for (const mode of ['scalar', 'simd'] as const) {
      const wasm = await load(mode);
      const source = new Uint32Array(wasm.memory.buffer, INPUT, 4);
      source.set([0x3f800000, 0x7fc00001, 0x80000000, 0x47800000]);
      const before = source.slice();
      expect(wasm.compact_uvs(INPUT - 2, OUTPUT, 1)).toBe(-1);
      expect(wasm.compact_uvs(INPUT, INPUT, 1)).toBe(-1);
      expect(wasm.pack_color_alpha(INPUT, INPUT, 1, 1)).toBe(-1);
      expect(wasm.pack_color_alpha(INPUT, OUTPUT, 1, 0)).toBe(-1);
      expect(wasm.offset_indices(INPUT, INPUT, 1, 0)).toBe(-1);
      expect(wasm.offset_indices(INPUT, OUTPUT, 1, -1)).toBe(-1);
      expect(source).toEqual(before);
    }
  });
});

it('mesh wrapper preserves unsigned maximum without confusing it with ABI errors', async () => {
  for (const name of ['scalar', 'simd']) {
    const { instance } = await WebAssembly.instantiate(
      await readFile(`changes/2026-09-07-data-plane-adoption/evidence/kernels-${name}.wasm`),
    );
    const kernel = new MeshPackKernel(new KernelMemory(instance.exports));
    expect(kernel.offsetIndices(Uint32Array.of(0x7fffffff, 0xfffffffe), 1)).toEqual({
      values: Uint32Array.of(0x80000000, 0xffffffff),
      maxIndex: 0xffffffff,
    });
    expect(kernel.failed).toBe(false);
  }
});

it('UV numeric reference agrees with the existing TS mesh conversion', () => {
  const bits = deterministicBits(4099);
  const original = compactMeshData({
    material: null,
    renderCategory: 'opaque',
    layout: 'float32',
    positions: new Float32Array(),
    normals: new Float32Array(),
    colors: new Uint8Array(),
    indices: new Uint16Array(),
    uvs: new Float32Array(Uint32Array.from(bits).buffer),
  });
  expect(original.uvs).toEqual(compactReference(bits));
});
