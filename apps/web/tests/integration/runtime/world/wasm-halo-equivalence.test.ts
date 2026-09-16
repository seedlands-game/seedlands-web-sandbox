import { deepStrictEqual } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createKernelMemory } from '../../../../src/compute/kernel-memory';
import { createHaloKernel, createHaloStaged } from '../../../../src/compute/halo-kernel';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { createProceduralMeshInput, makeChunk } from '../../../../../../packages/stdlib/src/world/mesh';

describe.each(['scalar', 'simd'])('W03 halo 与修订哈希对等 (%s)', (artifact) => {
  it('已知、未知和混合邻块，两版生成器和负坐标逐字节相同', async () => {
    const memory = await createKernelMemory(
      await readFile(new URL(`../../../../src/generated/wasm/rust-kernels-${artifact}.wasm`, import.meta.url)),
    );
    const prepare = createHaloKernel(memory);
    for (const version of [2, 3, 4])
      for (const cy of [-1, 0, 1])
        for (const cx of [-1, 0]) {
          const canonical = makeChunk(1837, cx, cy, 0, [], version);
          const overlay = makeChunk(1837, cx + 1, cy, 0, [], version);
          overlay[0] = 8;
          const overlayFluid = new Uint8Array(32768);
          overlayFluid[0] = 4;
          const options = {
            seed: 1837,
            cx,
            cy,
            cz: 0,
            generatorVersion: version,
            provider: classicWorldgenProvider,
            canonical,
            overlays: [{ cx: cx + 1, cy, cz: 0, voxels: overlay, fluid: overlayFluid }],
          };
          const original = createProceduralMeshInput(options);
          for (const result of [prepare(options), createHaloStaged(options)]) {
            deepStrictEqual(result.halo, original.halo);
            deepStrictEqual(result.fluidHalo, original.fluidHalo);
            expect(result.haloRevision).toBe(original.haloRevision);
            expect(result.canonical).toBe(canonical);
            deepStrictEqual(result.fluid, original.fluid);
            expect(result.proceduralVoxelSamples).toBe(original.proceduralVoxelSamples);
          }
          expect(memory.failed).toBe(false);
        }
  }, 30000);
});
