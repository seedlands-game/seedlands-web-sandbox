import { testCorePlatform } from '../support/core-platform';
import { describe, expect, it, vi } from 'vitest';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import type { ChunkSnapshot } from '../../packages/game-core/src/server/persistence/chunk-persistence';
import type { FrozenGameSaveSnapshot } from '../../packages/game-core/src/server/persistence/game-save-snapshot';
import {
  openNodePersistenceLaneProxy,
  type PersistenceLaneRpc,
} from '../../apps/node-server/src/node/persistence/persistence-lane-proxy';
import { GENERATOR_VERSION, Voxel } from '../../packages/game-core/src/world/voxel';

type Deferred<Value> = Readonly<{
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(error: unknown): void;
}>;

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const identity = Object.freeze({
  worldId: 'default',
  seedText: 'persistence-lane',
  generatorVersion: GENERATOR_VERSION,
});

function chunk(key: string, revision: number, voxel: number): ChunkSnapshot {
  const [cx, cy, cz] = key.split(',').map(Number) as [number, number, number];
  const voxels = new Uint16Array(32 * 32 * 32);
  voxels[0] = voxel;
  return {
    key,
    cx,
    cy,
    cz,
    seedText: identity.seedText,
    generatorVersion: identity.generatorVersion,
    revision,
    voxels,
  };
}

function rpcWith(
  request: PersistenceLaneRpc['request'],
): PersistenceLaneRpc & { request: ReturnType<typeof vi.fn<PersistenceLaneRpc['request']>> } {
  return {
    request: vi.fn(request),
    close: vi.fn(),
    diagnostics: vi.fn(() => ({
      accepted: 0,
      rejected: 0,
      pending: 0,
      queuedBytes: 0,
      inFlightBytes: 0,
      responseBytes: 0,
      staleMessages: 0,
      nextRequestId: 0,
      closed: false,
      activeHandlers: 0,
    })),
  };
}

async function openProxy(rpc: PersistenceLaneRpc) {
  return openNodePersistenceLaneProxy({
    rpc,
    identity,
    limits: {
      maxCachedChunks: 32,
      maxCachedBytes: 8 * 1_024 * 1_024,
      maxRetainedSaveBytes: 32 * 1_024 * 1_024,
    },
  });
}

describe('Persistence lane Authority 侧同步缓存', () => {
  it('同步读取不发送 RPC，且返回副本不会污染缓存', async () => {
    const prepared = chunk('0,0,0', 1, Voxel.Wood);
    const rpc = rpcWith(async (kind) => {
      if (kind === 'persistence-open') return { identity, gameplay: null, checkpoint: null };
      if (kind === 'persistence-ensure') return { key: prepared.key, status: 'found', snapshot: prepared };
      throw new Error(`unexpected ${kind}`);
    });
    const proxy = await openProxy(rpc);

    await proxy.ensureSnapshot(0, 0, 0);
    const callsAfterPrepare = rpc.request.mock.calls.length;
    const first = proxy.loadSnapshot('0,0,0')!;
    first.voxels[0] = Voxel.Lantern;

    expect(proxy.loadSnapshot('0,0,0')?.voxels[0]).toBe(Voxel.Wood);
    expect(proxy.preparedSnapshotStatus('0,0,0')).toBe('found');
    expect(proxy.loadGameplaySnapshot()).toBeNull();
    expect(proxy.loadGameCheckpoint()).toBeNull();
    expect(rpc.request).toHaveBeenCalledTimes(callsAfterPrepare);
  });

  it('evict 使在途 prepare token 失效，迟到回复不会重新驻留且元数据会释放', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    let ensureCount = 0;
    const rpc = rpcWith((kind) => {
      if (kind === 'persistence-open') return Promise.resolve({ identity, gameplay: null, checkpoint: null });
      if (kind === 'persistence-ensure') {
        ensureCount += 1;
        return ensureCount === 1 ? first.promise : second.promise;
      }
      return Promise.reject(new Error(`unexpected ${kind}`));
    });
    const proxy = await openProxy(rpc);

    const stalePrepare = proxy.ensureSnapshot(0, 0, 0);
    proxy.evictSnapshot('0,0,0');
    const currentPrepare = proxy.ensureSnapshot(0, 0, 0);
    first.resolve({ key: '0,0,0', status: 'found', snapshot: chunk('0,0,0', 1, Voxel.Wood) });
    await stalePrepare;
    expect(proxy.preparedSnapshotStatus('0,0,0')).toBe('unknown');

    second.resolve({ key: '0,0,0', status: 'found', snapshot: chunk('0,0,0', 2, Voxel.Lantern) });
    await currentPrepare;
    expect(proxy.loadSnapshot('0,0,0')).toMatchObject({ revision: 2 });
    proxy.evictSnapshot('0,0,0');
    expect(proxy.diagnostics()).toMatchObject({
      cachedChunkCount: 0,
      missingChunkCount: 0,
      prepareMetadataCount: 0,
    });
  });

  it('大量 missing prepare 在 evict 后不会留下永久 tombstone', async () => {
    const rpc = rpcWith(async (kind, payload) => {
      if (kind === 'persistence-open') return { identity, gameplay: null, checkpoint: null };
      if (kind === 'persistence-ensure') return { key: (payload as { key: string }).key, status: 'missing' };
      throw new Error(`unexpected ${kind}`);
    });
    const proxy = await openProxy(rpc);

    for (let cx = 0; cx < 128; cx += 1) {
      await proxy.ensureSnapshot(cx, 0, 0);
      proxy.evictSnapshot(`${cx},0,0`);
    }

    expect(proxy.diagnostics()).toMatchObject({
      cachedChunkCount: 0,
      missingChunkCount: 0,
      prepareMetadataCount: 0,
    });
  });

  it.each(['restored', 'generated', 'synchronous'] as const)(
    'canonical 接管 %s 后释放准备缓存，连续探索不耗尽条目',
    async (mode) => {
      const rpc = rpcWith(async (kind, payload) => {
        if (kind === 'persistence-open') return { identity, gameplay: null, checkpoint: null };
        if (kind === 'persistence-ensure') {
          const key = (payload as { key: string }).key;
          return mode === 'restored'
            ? { key, status: 'found', snapshot: chunk(key, 7, Voxel.Wood) }
            : { key, status: 'missing' };
        }
        throw new Error(`unexpected ${kind}`);
      });
      const proxy = await openNodePersistenceLaneProxy({ rpc, identity, limits: { maxCachedChunks: 2 } });
      const server = new GameServer({
        platform: testCorePlatform,
        seedText: identity.seedText,
        persistence: proxy,
        ...(mode === 'synchronous' ? {} : { onUnknownChunk: () => undefined }),
      });
      for (let cx = 0; cx < 8; cx += 1) {
        const available = await server.prepareCanonicalChunkForMutation(cx, 0, 0);
        if (mode === 'generated') {
          expect(available).toBe(false);
          expect(
            server.acceptWorkerCanonical({
              key: `${cx},0,0`,
              cx,
              cy: 0,
              cz: 0,
              chunkRevision: 0,
              generatorVersion: GENERATOR_VERSION,
              canonical: new Uint16Array(32 ** 3),
            }),
          ).toBe(true);
        } else expect(available).toBe(true);
      }
      expect(proxy.diagnostics()).toMatchObject({ cachedChunkCount: 0, missingChunkCount: 0, prepareMetadataCount: 0 });
      expect(server.hasLoadedCanonicalChunk('0,0,0')).toBe(true);
      if (mode === 'restored') expect(server.getChunk(0, 0, 0)).toMatchObject({ revision: 7, persistedRevision: 7 });
    },
  );

  it('在途 prepare 元数据受缓存条目上限约束', async () => {
    const replies = [deferred<unknown>(), deferred<unknown>()];
    let index = 0;
    const rpc = rpcWith((kind) => {
      if (kind === 'persistence-open') return Promise.resolve({ identity, gameplay: null, checkpoint: null });
      if (kind === 'persistence-ensure') return replies[index++].promise;
      return Promise.reject(new Error(`unexpected ${kind}`));
    });
    const proxy = await openNodePersistenceLaneProxy({
      rpc,
      identity,
      limits: { maxCachedChunks: 1, maxCachedBytes: 1_024, maxRetainedSaveBytes: 1_024 },
    });

    const first = proxy.ensureSnapshot(0, 0, 0);
    const second = proxy.ensureSnapshot(1, 0, 0);
    expect(proxy.diagnostics().prepareMetadataCount).toBe(1);
    replies[0].resolve({ key: '0,0,0', status: 'missing' });
    replies[1].resolve({ key: '1,0,0', status: 'missing' });
    await first;
    await second.catch(() => undefined);
  });

  it('neighborhood RPC 失败只传播给调用者，不产生每 key 的派生拒绝', async () => {
    const rpc = rpcWith(async (kind) => {
      if (kind === 'persistence-open') return { identity, gameplay: null, checkpoint: null };
      if (kind === 'persistence-ensure-neighborhood') throw new Error('neighborhood failed');
      throw new Error(`unexpected ${kind}`);
    });
    const proxy = await openProxy(rpc);

    await expect(proxy.ensureNeighborhood(0, 0, 0)).rejects.toThrow('neighborhood failed');
    await Promise.resolve();
    expect(proxy.diagnostics()).toMatchObject({ prepareMetadataCount: 0 });
  });

  it('保存排队前复制冻结体，调用方修改不会改变传输 payload', async () => {
    const saveReply = deferred<unknown>();
    const sent: FrozenGameSaveSnapshot[] = [];
    const rpc = rpcWith((kind, payload) => {
      if (kind === 'persistence-open') return Promise.resolve({ identity, gameplay: null, checkpoint: null });
      if (kind === 'persistence-save-frozen') {
        sent.push((payload as { snapshot: FrozenGameSaveSnapshot }).snapshot);
        return saveReply.promise;
      }
      return Promise.reject(new Error(`unexpected ${kind}`));
    });
    const proxy = await openProxy(rpc);
    const server = new GameServer({ platform: testCorePlatform, seedText: identity.seedText });
    server.spawnPlayer({ id: 'player', position: [0.5, 34, 0.5] });
    server.edit(0, 20, 0, Voxel.Wood);
    const frozen = server.freezeSaveSnapshot(1);

    const saving = proxy.saveFrozenSnapshot(frozen);
    const mutable = frozen as unknown as {
      gameplay: { entities: Array<{ position: [number, number, number] }> };
      chunks: Array<{ voxels: Uint16Array }>;
    };
    mutable.gameplay.entities[0].position[1] = 999;
    mutable.chunks[0].voxels.fill(Voxel.Lantern);
    await Promise.resolve();

    expect(sent[0]?.gameplay.entities[0].position).toEqual([0.5, 34, 0.5]);
    expect(sent[0]?.chunks[0].voxels).toContain(Voxel.Wood);
    saveReply.resolve({ checkpoint: { commitSequence: 1, worldRevision: 1 } });
    await saving;
  });

  it('迟到 durable ACK 不覆盖其后 prepare 的新 revision，也不重新插入已 evict Chunk', async () => {
    const saveReplies = [deferred<unknown>(), deferred<unknown>()];
    let saveIndex = 0;
    let ensureRevision = 1;
    const rpc = rpcWith(async (kind, payload) => {
      if (kind === 'persistence-open') return { identity, gameplay: null, checkpoint: null };
      if (kind === 'persistence-ensure') {
        const key = (payload as { key: string }).key;
        return { key, status: 'found', snapshot: chunk(key, ensureRevision, Voxel.Wood) };
      }
      if (kind === 'persistence-save-frozen') return saveReplies[saveIndex++].promise;
      throw new Error(`unexpected ${kind}`);
    });
    const proxy = await openProxy(rpc);
    await proxy.ensureSnapshot(0, 0, 0);
    const server = new GameServer({ platform: testCorePlatform, seedText: identity.seedText });
    server.edit(0, 20, 0, Voxel.Lantern);
    const firstSave = proxy.saveFrozenSnapshot(server.freezeSaveSnapshot(1));

    proxy.evictSnapshot('0,0,0');
    ensureRevision = 2;
    await proxy.ensureSnapshot(0, 0, 0);
    saveReplies[0].resolve({ checkpoint: { commitSequence: 1, worldRevision: 1 } });
    await firstSave;
    expect(proxy.loadSnapshot('0,0,0')).toMatchObject({ revision: 2 });

    const secondSave = proxy.saveFrozenSnapshot(server.freezeSaveSnapshot(2));
    proxy.evictSnapshot('0,0,0');
    saveReplies[1].resolve({ checkpoint: { commitSequence: 2, worldRevision: 1 } });
    await secondSave;
    expect(proxy.preparedSnapshotStatus('0,0,0')).toBe('unknown');
  });

  it('冻结保存超过本地预算时在复制前拒绝', async () => {
    const rpc = rpcWith(async (kind) => {
      if (kind === 'persistence-open') return { identity, gameplay: null, checkpoint: null };
      throw new Error(`unexpected ${kind}`);
    });
    const proxy = await openNodePersistenceLaneProxy({
      rpc,
      identity,
      limits: { maxCachedChunks: 1, maxCachedBytes: 1, maxRetainedSaveBytes: 1 },
    });
    const server = new GameServer({ platform: testCorePlatform, seedText: identity.seedText });
    server.edit(0, 20, 0, Voxel.Wood);
    const frozen = server.freezeSaveSnapshot(1);
    const clone = vi.spyOn(globalThis, 'structuredClone');

    await expect(proxy.saveFrozenSnapshot(frozen)).rejects.toThrow(/字节上限/);
    expect(clone).not.toHaveBeenCalled();
    clone.mockRestore();
  });
});
