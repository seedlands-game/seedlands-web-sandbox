import { deepStrictEqual } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { createKernelMemory } from '../../../../src/compute/kernel-memory';
import { createHaloKernel, createHaloStaged } from '../../../../src/compute/halo-kernel';
import { createChunkKernel, makeChunkStaged } from '../../../../src/compute/chunk-kernel';
import { createCodecKernel, encodeStoredChunkRecord } from '../../../../src/compute/codec-kernel';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { createStoredChunkRecord } from '../../../../../../packages/stdlib/src/world/chunk-snapshot-codec';
import { GENERATOR_VERSION } from '../../../../../../packages/stdlib/src/world/voxel';
import { makeWorkloadCorpus } from '../../../support/performance/workload-corpus';
const path = process.env.SEEDLANDS_ADOPTION_RUST ?? 'apps/web/src/generated/wasm/rust-kernels-scalar.wasm';
it('Rust core artifact matches exact chunk and codec production outputs with no fallback', async () => {
  const memory = await createKernelMemory(await readFile(path!));
  const codec = createCodecKernel(memory);
  expect(memory.invoke('crc32_bytes', 64, 0) >>> 0).toBe(0);
  for (const input of makeWorkloadCorpus('w14')) {
    if (input.kind !== 'w14') throw new Error('corpus');
    const before = structuredClone(input.record);
    deepStrictEqual(encodeStoredChunkRecord(codec, input.record), createStoredChunkRecord(input.record));
    deepStrictEqual(input.record, before);
    expect(memory.failed).toBe(false);
  }
  for (const input of makeWorkloadCorpus('w03')) {
    if (input.kind !== 'w03') throw new Error('corpus');
    const generatorVersion = input.options.generatorVersion ?? GENERATOR_VERSION;
    const canonical =
      input.options.canonical ??
      classicWorldgenProvider.generate({
        seed: input.options.seed,
        generatorVersion,
        coordinate: { x: input.options.cx, y: input.options.cy, z: input.options.cz },
        epoch: 0,
        revision: 0,
      }).voxels;
    const options = { ...input.options, generatorVersion, canonical, provider: classicWorldgenProvider };
    deepStrictEqual(createHaloKernel(memory)(options), createHaloStaged(options));
    expect(memory.failed).toBe(false);
  }
  for (const input of makeWorkloadCorpus('w02')) {
    if (input.kind !== 'w02') throw new Error('corpus');
    deepStrictEqual(createChunkKernel(memory)(...input.args), makeChunkStaged(...input.args));
    expect(memory.failed).toBe(false);
  }
}, 120_000);
