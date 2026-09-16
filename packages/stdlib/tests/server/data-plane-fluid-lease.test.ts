import { describe, expect, it } from 'vitest';
import {
  FluidTransactionAuthority,
  computeFluidCandidate,
  consumeFluidCandidate,
  type FluidCellValue,
  type FluidChunkSnapshot,
  type FluidPosition,
} from '../../src/server/fluid/fluid-transaction';
import { CHUNK_SIZE, chunkKey, floorDiv, mod, voxelIndex, Voxel } from '../../src/world/voxel';

const keyFor = ([x, y, z]: FluidPosition) =>
  chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));

const localIndex = ([x, y, z]: FluidPosition) => voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE));

const makeChunk = (cx: number, cy: number, cz: number): FluidChunkSnapshot => ({
  key: chunkKey(cx, cy, cz),
  cx,
  cy,
  cz,
  revision: 0,
  voxels: new Uint16Array(CHUNK_SIZE ** 3),
  fluid: new Uint8Array(CHUNK_SIZE ** 3),
});

const setCell = (chunks: Map<string, FluidChunkSnapshot>, position: FluidPosition, value: FluidCellValue) => {
  const chunk = chunks.get(keyFor(position))!;
  const index = localIndex(position);
  chunk.voxels[index] = value.voxel;
  chunk.fluid[index] = value.fluid;
};

const createSourceFlowLease = () => {
  const chunk = makeChunk(0, 1, 0);
  const chunks = new Map([[chunk.key, chunk]]);
  setCell(chunks, [0, 49, 0], { voxel: Voxel.Stone, fluid: 0 });
  setCell(chunks, [0, 50, 0], { voxel: Voxel.Water, fluid: 0x88 });
  const authority = new FluidTransactionAuthority({
    epoch: 1,
    readChunk: (key) => chunks.get(key) ?? null,
    readCell: (position) => {
      const source = chunks.get(keyFor(position));
      if (!source) return null;
      const index = localIndex(position);
      return { voxel: source.voxels[index], fluid: source.fluid[index] };
    },
    apply: () => undefined,
  });
  authority.activate([0, 50, 0]);
  return { authority, lease: authority.requestFluidWork()! };
};

describe('fluid worker data-plane ownership', () => {
  it('在主线程与 worker 克隆并转移、worker 消费失败后保留 Authority lease 并可等价重试', () => {
    const { authority, lease } = createSourceFlowLease();
    const authorityArraysBefore = lease.chunks.map(({ voxels, fluid }) => ({
      voxels: voxels.slice(),
      fluid: fluid.slice(),
    }));
    const pureReference = computeFluidCandidate(lease);

    // Authority -> main: clone 保留 Authority 的 lease backing buffers。
    const mainOwned = structuredClone(lease);
    // main -> worker: 仅转移 main 的 clone；worker 可独占消费。
    const workerBuffers = mainOwned.chunks.flatMap(({ voxels, fluid }) => [
      voxels.buffer as ArrayBuffer,
      fluid.buffer as ArrayBuffer,
    ]);
    const workerOwned = structuredClone(mainOwned, { transfer: workerBuffers });
    expect(mainOwned.chunks.every(({ voxels, fluid }) => voxels.byteLength === 0 && fluid.byteLength === 0)).toBe(true);

    const consumedCandidate = consumeFluidCandidate(workerOwned);
    expect(consumedCandidate).toEqual(pureReference);
    expect(consumedCandidate.writes.length).toBeGreaterThan(0);

    expect(authority.abortLease(lease.workId, 'worker failure')).toBe(true);
    expect(lease.chunks.map(({ voxels, fluid }) => ({ voxels, fluid }))).toEqual(authorityArraysBefore);

    const retry = authority.requestFluidWork();
    expect(retry).not.toBeNull();
    if (!retry) throw new Error('expected retried lease');
    expect(retry.frontier).toEqual(lease.frontier);
    expect(retry.cleanupFrontier).toEqual(lease.cleanupFrontier);

    const retriedCandidate = computeFluidCandidate(retry);
    expect({ ...retriedCandidate, workId: pureReference.workId }).toEqual(pureReference);
  });
});
