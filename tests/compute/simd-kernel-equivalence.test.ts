import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { collisionBoxesForVoxel } from '../../src/world/voxel-model';
import { expect, it } from 'vitest';
const root = 'changes/2026-09-06-data-plane-simd-policy/evidence/';
it('scalar and SIMD classify all voxel ids and unaligned vector tails identically', async () => {
  for (const name of ['scalar', 'simd']) {
    const { instance } = await WebAssembly.instantiate(await readFile(`${root}kernels-${name}.wasm`));
    const memory = instance.exports.memory as WebAssembly.Memory;
    const stack = instance.exports.__stack_pointer as WebAssembly.Global;
    const dataEnd = instance.exports.__data_end as WebAssembly.Global;
    const heapBase = instance.exports.__heap_base as WebAssembly.Global;
    expect(Number(dataEnd.value)).toBeGreaterThanOrEqual(16 * 1024 * 1024);
    expect(Number(stack.value) - 1024 * 1024).toBeGreaterThanOrEqual(Number(dataEnd.value));
    expect(Number(heapBase.value)).toBeGreaterThanOrEqual(Number(stack.value));
    new Uint8Array(memory.buffer, 64, 16 * 1024 * 1024 - 64).fill(0xff);
    const occupancy = instance.exports.occupancy as (a: number, b: number, n: number) => number;
    for (const count of [0, 1, 7, 8, 15, 16, 17, 65536]) {
      const input = new Uint16Array(memory.buffer, 66, count);
      for (let i = 0; i < count; i++) input[i] = i;
      expect(occupancy(66, 262145, count)).toBe(0);
      expect(Array.from(new Uint8Array(memory.buffer, 262145, count))).toEqual(
        Array.from({ length: count }, (_, i) => Number(collisionBoxesForVoxel(i).length > 0)),
      );
    }
    expect(occupancy(65, 262145, 1)).toBe(-1);
    expect(occupancy(66, 70, 30)).toBe(-1);
  }
});

it('experiment artifacts and Rust sources match the recorded build', async () => {
  const manifest = JSON.parse(await readFile(`${root}simd-build-manifest.json`, 'utf8'));
  for (const [path, expected] of Object.entries(manifest.sources))
    expect(
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    ).toBe(expected);
  for (const name of ['scalar', 'simd'])
    expect(
      createHash('sha256')
        .update(await readFile(`${root}kernels-${name}.wasm`))
        .digest('hex'),
    ).toBe(manifest[name].sha256);
});
