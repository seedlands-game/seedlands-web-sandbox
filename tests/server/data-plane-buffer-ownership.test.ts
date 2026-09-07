import { describe, expect, it, vi } from 'vitest';
import {
  AuthorityCollisionBaselineClient,
  type AuthorityCollisionBaselinePayload,
} from '../../src/client/authority/authority-collision-baseline-client';
import {
  AuthorityCollisionRevisionGuard,
  acceptAuthorityCollisionBaseline,
  consumeTransferredAuthorityCollisionBaseline,
  type AuthorityCollisionCachedChunk,
} from '../../src/client/authority/authority-collision-mirror';
import {
  computeFluidCandidate,
  consumeFluidCandidate,
  type FluidAuthoritySnapshot,
} from '../../src/server/fluid/fluid-transaction';
import { CHUNK_SIZE, Voxel, voxelIndex } from '../../src/world/voxel';

const snapshot = (): FluidAuthoritySnapshot => {
  const voxels = new Uint16Array(CHUNK_SIZE ** 3);
  const fluid = new Uint8Array(CHUNK_SIZE ** 3);
  voxels[voxelIndex(1, 18, 1)] = Voxel.Water;
  fluid[voxelIndex(1, 18, 1)] = 0x88;
  return {
    protocolVersion: 1,
    epoch: 7,
    workId: 'exclusive-worker-input',
    frontier: [[1, 50, 1]],
    chunks: [{ key: '0,1,0', cx: 0, cy: 1, cz: 0, revision: 2, voxels, fluid }],
  };
};

describe('数据平面缓冲所有权', () => {
  it('公开 baseline client 仍复制可注入 request 的返回 buffer', async () => {
    const canonical = new Uint16Array(CHUNK_SIZE ** 3);
    const fluid = new Uint8Array(CHUNK_SIZE ** 3);
    const chunks = new Map<string, AuthorityCollisionCachedChunk>();
    const client = new AuthorityCollisionBaselineClient(chunks, new AuthorityCollisionRevisionGuard(), async () => ({
      status: 'available',
      key: '0,0,0',
      chunkRevision: 3,
      canonical: canonical.buffer,
      fluid: fluid.buffer,
    }));

    client.synchronize({ '0,0,0': 3 });
    await vi.waitFor(() => expect(chunks.get('0,0,0')?.chunkRevision).toBe(3));

    expect(chunks.get('0,0,0')?.canonical.buffer).not.toBe(canonical.buffer);
    expect(chunks.get('0,0,0')?.fluid.buffer).not.toBe(fluid.buffer);
    canonical[0] = Voxel.Water;
    fluid[0] = 0x88;
    expect(chunks.get('0,0,0')?.canonical[0]).toBe(0);
    expect(chunks.get('0,0,0')?.fluid[0]).toBe(0);
  });

  it('接管已 transfer 的碰撞基线 buffer，不再在主线程复制', async () => {
    const sourceCanonical = new Uint16Array(CHUNK_SIZE ** 3);
    const sourceFluid = new Uint8Array(CHUNK_SIZE ** 3);
    const transferred = structuredClone(
      { canonical: sourceCanonical.buffer, fluid: sourceFluid.buffer },
      { transfer: [sourceCanonical.buffer, sourceFluid.buffer] },
    );
    const canonical = new Uint16Array(transferred.canonical);
    const fluid = new Uint8Array(transferred.fluid);
    canonical[0] = Voxel.Stone;
    const chunks = new Map<string, AuthorityCollisionCachedChunk>();
    const client = new AuthorityCollisionBaselineClient(
      chunks,
      new AuthorityCollisionRevisionGuard(),
      async () =>
        ({
          status: 'available',
          key: '0,0,0',
          chunkRevision: 3,
          canonical: canonical.buffer,
          fluid: fluid.buffer,
        }) satisfies AuthorityCollisionBaselinePayload,
      { consumeTransferredBuffers: true },
    );

    client.synchronize({ '0,0,0': 3 });
    await vi.waitFor(() => expect(chunks.get('0,0,0')?.chunkRevision).toBe(3));

    expect(chunks.get('0,0,0')?.canonical.buffer).toBe(canonical.buffer);
    expect(chunks.get('0,0,0')?.fluid.buffer).toBe(fluid.buffer);
    expect(sourceCanonical.byteLength).toBe(0);
    expect(sourceFluid.byteLength).toBe(0);
  });

  it('准备缓存命中时直接保留 worker 生成的 canonical，不构造发送副本', async () => {
    const received = new Uint16Array(CHUNK_SIZE ** 3);
    received[0] = Voxel.Dirt;
    const chunks = new Map<string, AuthorityCollisionCachedChunk>();
    const accept = vi.fn(async () => true);

    await expect(
      consumeTransferredAuthorityCollisionBaseline({
        key: '0,0,0',
        chunkRevision: 4,
        generatorVersion: 3,
        result: { canonical: received.buffer, generatorVersion: 3 },
        chunks,
        guard: new AuthorityCollisionRevisionGuard(),
        accept,
      }),
    ).resolves.toBe(true);

    expect(accept).toHaveBeenCalledOnce();
    expect(accept).toHaveBeenCalledWith();
    expect(chunks.get('0,0,0')?.canonical.buffer).toBe(received.buffer);
  });

  it('公开 generated canonical 回调可 detach 参数而不影响缓存副本', async () => {
    const received = new Uint16Array(CHUNK_SIZE ** 3);
    received[0] = Voxel.Dirt;
    const chunks = new Map<string, AuthorityCollisionCachedChunk>();

    await expect(
      acceptAuthorityCollisionBaseline({
        key: '0,0,0',
        chunkRevision: 4,
        generatorVersion: 3,
        result: { canonical: received.buffer, generatorVersion: 3 },
        chunks,
        guard: new AuthorityCollisionRevisionGuard(),
        accept: async (dispatchOwned) => {
          structuredClone(dispatchOwned.buffer, { transfer: [dispatchOwned.buffer] });
          return true;
        },
      }),
    ).resolves.toBe(true);

    expect(chunks.get('0,0,0')?.canonical[0]).toBe(Voxel.Dirt);
    expect(chunks.get('0,0,0')?.canonical.buffer).not.toBe(received.buffer);
  });

  it('公开 fluid 计算保留输入，而 worker 专用消费接口直接复用独占数组', () => {
    const reusable = snapshot();
    const before = reusable.chunks[0]!.voxels.slice();
    const expected = computeFluidCandidate(reusable);
    expect(reusable.chunks[0]!.voxels).toEqual(before);

    const exclusive = snapshot();
    const voxelSlice = vi.spyOn(Uint16Array.prototype, 'slice');
    const fluidSlice = vi.spyOn(Uint8Array.prototype, 'slice');
    const consumed = consumeFluidCandidate(exclusive);

    expect(consumed).toEqual(expected);
    expect(consumed.writes.length).toBeGreaterThan(0);
    expect(voxelSlice).not.toHaveBeenCalled();
    expect(fluidSlice).not.toHaveBeenCalled();
    voxelSlice.mockRestore();
    fluidSlice.mockRestore();
  });
});
