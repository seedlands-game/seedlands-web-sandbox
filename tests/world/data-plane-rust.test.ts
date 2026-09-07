import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { createKernelMemory } from '../../apps/web/src/compute/kernel-memory';
import { createHaloKernel, createHaloStaged } from '../../apps/web/src/compute/halo-kernel';
import { createChunkKernel, makeChunkStaged } from '../../apps/web/src/compute/chunk-kernel';
import { createCodecKernel, encodeStoredChunkRecord } from '../../apps/web/src/compute/codec-kernel';
import { createStoredChunkRecord } from '../../packages/game-core/src/world/chunk-snapshot-codec';
import { makeWorkloadCorpus } from '../../changes/2026-09-07-data-plane-adoption/e2e/workload-corpus';
const path = process.env.SEEDLANDS_ADOPTION_RUST ?? 'apps/web/src/generated/wasm/rust-kernels-scalar.wasm';
it('Rust core artifact matches exact chunk and codec production outputs with no fallback', async () => {
  const memory = await createKernelMemory(await readFile(path!));
  const codec = createCodecKernel(memory);
  expect(memory.invoke('crc32_bytes', 64, 0) >>> 0).toBe(0);
  for (const input of makeWorkloadCorpus('w14')) {
    if (input.kind !== 'w14') throw new Error('corpus');
    const before = structuredClone(input.record);
    expect(encodeStoredChunkRecord(codec, input.record)).toEqual(createStoredChunkRecord(input.record));
    expect(input.record).toEqual(before);
    expect(memory.failed).toBe(false);
  }
  for (const input of makeWorkloadCorpus('w03')) {
    if (input.kind !== 'w03') throw new Error('corpus');
    expect(createHaloKernel(memory)(input.options)).toEqual(createHaloStaged(input.options));
    expect(memory.failed).toBe(false);
  }
  for (const input of makeWorkloadCorpus('w02')) {
    if (input.kind !== 'w02') throw new Error('corpus');
    expect(createChunkKernel(memory)(...input.args)).toEqual(makeChunkStaged(...input.args));
    expect(memory.failed).toBe(false);
  }
}, 120_000);
