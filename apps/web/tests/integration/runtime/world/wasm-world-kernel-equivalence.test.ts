import { deepStrictEqual } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { makeChunk } from '../../../../../../packages/stdlib/src/world/chunk-generation';
import { createKernelMemory } from '../../../../src/compute/kernel-memory';
import { createChunkKernel, makeChunkStaged } from '../../../../src/compute/chunk-kernel';

describe.each(['scalar', 'simd'])('W02 批量地形填充保留确定性 (%s)', (artifact) => {
  it('生成器版本、负坐标、边界及树冠与原算法逐字节一致', async () => {
    const bytes = await readFile(
      new URL(`../../../../src/generated/wasm/rust-kernels-${artifact}.wasm`, import.meta.url),
    );
    const memory = await createKernelMemory(bytes);
    const generate = createChunkKernel(memory);
    for (const version of [2, 3, 4]) {
      for (const seed of [0, 1, 0xffffffff, 18374655]) {
        for (const [cx, cy, cz] of [
          [0, 0, 0],
          [-1, 0, -1],
          [1, 1, 2],
          [24, 0, -32],
          [0, -1, 0],
        ]) {
          const changes: [number, number, number, number][] = [
            [cx * 32, cy * 32, cz * 32, 9],
            [cx * 32 + 31, cy * 32 + 31, cz * 32 + 31, 10],
            [cx * 32, cy * 32, cz * 32, 0],
            [cx * 32 - 1, cy * 32, cz * 32, 5],
          ];
          const expected = makeChunk(seed, cx, cy, cz, changes, version);
          deepStrictEqual(generate(seed, cx, cy, cz, changes, version), expected);
          expect(memory.failed).toBe(false);
          deepStrictEqual(makeChunkStaged(seed, cx, cy, cz, changes, version), expected);
        }
      }
    }
  }, 30000);

  it('内核失败时明确拒绝且不绕过已选择的provider实现', async () => {
    const bytes = await readFile(
      new URL(`../../../../src/generated/wasm/rust-kernels-${artifact}.wasm`, import.meta.url),
    );
    const memory = await createKernelMemory(bytes);
    memory.failed = true;
    const generate = createChunkKernel(memory);
    expect(() => generate(1, 0, 0, 0, [], 3)).toThrow(/unavailable/i);
  });
});
