import { describe, expect, it } from 'vitest';
import {
  computeFluidCandidate,
  type FluidAuthoritySnapshot,
  type FluidPosition,
} from '../../../../../../packages/stdlib/src/server/fluid/fluid-transaction';
import { KernelMemory, WASM_ARENA_BYTES } from '../../../../src/compute/kernel-memory';
import { createFluidControlMemory } from '../../../../src/compute/fluid-kernel-control';
import { createFluidKernel } from '../../../../src/worker/fluid-kernel';
import { voxelIndex } from '../../../../../../packages/stdlib/src/world/voxel';

const applyWrites = (snapshot: FluidAuthoritySnapshot) => {
  const expected = computeFluidCandidate(snapshot);
  for (const write of expected.writes) {
    const [x, y, z] = write.position;
    const chunk = snapshot.chunks.find(
      (candidate) =>
        candidate.cx === Math.floor(x / 32) &&
        candidate.cy === Math.floor(y / 32) &&
        candidate.cz === Math.floor(z / 32),
    );
    if (!chunk) continue;
    const index = voxelIndex(((x % 32) + 32) % 32, ((y % 32) + 32) % 32, ((z % 32) + 32) % 32);
    chunk.voxels[index] = write.voxel;
    chunk.fluid[index] = write.fluid;
  }
  snapshot.frontier = expected.nextFrontier.slice(0, 128);
  snapshot.cleanupFrontier = expected.nextCleanupFrontier;
};

describe('W07 同布局 TypeScript 流体控制', () => {
  it('对 arena 内但不匹配输入 Chunk 的输出指针整项回退', () => {
    const wasmMemory = new WebAssembly.Memory({ initial: WASM_ARENA_BYTES / 65536 });
    const badPointerMemory = new KernelMemory({
      memory: wasmMemory,
      abi_version: () => 1,
      arena_bytes: () => WASM_ARENA_BYTES,
      fluid_candidate: () => {
        const header = new Uint32Array(wasmMemory.buffer);
        header[18] = 1;
        const rows = new Uint32Array(wasmMemory.buffer, 4 * 1024 * 1024, 6);
        rows.set([0, 0, 0, 0, 200_000, 300_000]);
        new Uint16Array(wasmMemory.buffer, 200_000, 1)[0] = 8;
        new Uint8Array(wasmMemory.buffer, 300_000, 1)[0] = 1;
        return 0;
      },
    } as unknown as WebAssembly.Exports);
    const snapshot: FluidAuthoritySnapshot = {
      protocolVersion: 1,
      epoch: 1,
      workId: 'bad-pointers',
      frontier: [[0, 0, 0]],
      chunks: [
        {
          key: '0,0,0',
          cx: 0,
          cy: 0,
          cz: 0,
          revision: 0,
          voxels: new Uint16Array(32768),
          fluid: new Uint8Array(32768),
        },
      ],
    };

    const candidate = createFluidKernel(badPointerMemory)(snapshot);

    expect(candidate).toEqual(computeFluidCandidate(snapshot));
    expect(badPointerMemory.failed).toBe(true);
  });

  it('与生产候选在跨块、负坐标、未知依赖和连续 tick 中逐字段相同', () => {
    const memory = createFluidControlMemory();
    const compute = createFluidKernel(memory);
    let state = 0x1a2b3c4d;
    const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
    for (let scene = 0; scene < 16; scene += 1) {
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
      for (const chunk of chunks)
        for (let z = 0; z < 32; z += 1)
          for (let x = 0; x < 32; x += 1) {
            chunk.voxels[voxelIndex(x, 8, z)] = random() % 8 ? 3 : 0;
            if (random() % 4 !== 0) continue;
            const index = voxelIndex(x, 9, z);
            chunk.voxels[index] = 8;
            chunk.fluid[index] = [0, 0x88, 1, 2, 5, 7, 8][random() % 7];
            if (frontier.length < 128) frontier.push([chunk.cx * 32 + x, 9, z]);
          }
      const snapshot: FluidAuthoritySnapshot = {
        protocolVersion: 1,
        epoch: 4,
        workId: `control-${scene}`,
        frontier,
        cleanupFrontier: [...frontier.slice(0, 64).reverse(), [-33, 9, 0]],
        chunks,
      };
      for (let tick = 0; tick < 4; tick += 1) {
        const expected = computeFluidCandidate(snapshot);
        expect(compute(snapshot)).toEqual(expected);
        expect(memory.failed).toBe(false);
        applyWrites(snapshot);
      }
    }
  }, 30_000);
});
