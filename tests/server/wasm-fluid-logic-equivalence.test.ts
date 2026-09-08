import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  computeFluidCandidate,
  type FluidAuthoritySnapshot,
  type FluidPosition,
} from '../../packages/game-core/src/server/fluid/fluid-transaction';
import { createKernelMemory } from '../../apps/web/src/compute/kernel-memory';
import { createFluidKernel } from '../../apps/web/src/worker/fluid-kernel';
import { voxelIndex } from '../../packages/game-core/src/world/voxel';

describe('W07 有序流体候选对等', () => {
  it('跨块源水、退水、未知邻块及连续事务逐字段相同', async () => {
    const memory = await createKernelMemory(
      await readFile(new URL('../../apps/web/src/generated/wasm/rust-kernels-scalar.wasm', import.meta.url)),
    );
    const compute = createFluidKernel(memory);
    let random = 0x12345678;
    const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0);
    for (let scene = 0; scene < 30; scene += 1) {
      const chunks = [-1, 0, 1].slice(0, (scene % 3) + 1).map((cx) => ({
        key: `${cx},0,0`,
        cx,
        cy: 0,
        cz: 0,
        revision: scene,
        voxels: new Uint16Array(32768),
        fluid: new Uint8Array(32768),
      }));
      const frontier: FluidPosition[] = [];
      for (const chunk of chunks) {
        for (let z = 0; z < 32; z += 1)
          for (let x = 0; x < 32; x += 1) {
            chunk.voxels[voxelIndex(x, 9, z)] = next() % 9 ? 3 : 0;
            if (next() % 3 === 0) {
              const index = voxelIndex(x, 10, z);
              chunk.voxels[index] = 8;
              chunk.fluid[index] = [0, 0x88, 1, 3, 7, 8][next() % 6];
              if (frontier.length < 128) frontier.push([chunk.cx * 32 + x, 10, z]);
            }
          }
      }
      const input: FluidAuthoritySnapshot = {
        protocolVersion: 1,
        epoch: 2,
        workId: `w${scene}`,
        frontier,
        cleanupFrontier: frontier.slice(0, 64).reverse(),
        chunks,
      };
      for (let tick = 0; tick < 4; tick += 1) {
        const before = chunks.map((chunk) => [chunk.voxels.slice(), chunk.fluid.slice()]);
        const expected = computeFluidCandidate(input);
        expect(compute(input)).toEqual(expected);
        expect(memory.failed).toBe(false);
        chunks.forEach((chunk, i) => {
          expect(chunk.voxels).toEqual(before[i][0]);
          expect(chunk.fluid).toEqual(before[i][1]);
        });
        for (const write of expected.writes) {
          const [x, y, z] = write.position;
          const chunk = chunks.find((value) => value.cx === Math.floor(x / 32));
          if (!chunk || y < 0 || y >= 32 || z < 0 || z >= 32) continue;
          const index = voxelIndex(((x % 32) + 32) % 32, y, z);
          chunk.voxels[index] = write.voxel;
          chunk.fluid[index] = write.fluid;
        }
        input.frontier = expected.nextFrontier.slice(0, 128);
        input.cleanupFrontier = [];
      }
    }
  }, 120_000);
});
