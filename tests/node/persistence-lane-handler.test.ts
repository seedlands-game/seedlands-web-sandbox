import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileGamePersistence } from '../../src/node/persistence/file-game-persistence';
import { createPersistenceLaneRequestHandler } from '../../src/node/persistence/persistence-lane-handler';
import { PERSISTENCE_LANE_PROTOCOL_VERSION } from '../../src/node/persistence/persistence-lane-protocol';
import { GameServer } from '../../src/server/game-server';
import type { ChunkSnapshot } from '../../src/server/persistence/chunk-persistence';
import { GENERATOR_VERSION, Voxel } from '../../src/world/voxel';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryWorld(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'seedlands-persistence-handler-'));
  directories.push(directory);
  return directory;
}

describe('Persistence lane Worker 业务处理器', () => {
  it('只对 bootstrap 已打开的 store 做身份握手、准备、保存和关闭', async () => {
    const directory = await temporaryWorld();
    const store = await FileGamePersistence.open({
      directory,
      seedText: 'handler-world',
      generatorVersion: GENERATOR_VERSION,
    });
    const handler = createPersistenceLaneRequestHandler({
      store,
      identity: { worldId: 'default', seedText: 'handler-world', generatorVersion: GENERATOR_VERSION },
    });
    await expect(
      handler.handle({
        kind: 'persistence-open',
        payload: {
          version: PERSISTENCE_LANE_PROTOCOL_VERSION,
          identity: { worldId: 'default', seedText: 'handler-world', generatorVersion: GENERATOR_VERSION },
        },
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ identity: { seedText: 'handler-world' }, checkpoint: null });
    await expect(
      FileGamePersistence.open({ directory, seedText: 'handler-world', generatorVersion: GENERATOR_VERSION }),
    ).rejects.toThrow(/锁|lock|writer/i);

    const server = new GameServer({ seedText: 'handler-world' });
    server.edit(0, 20, 0, Voxel.Wood);
    const frozen = server.freezeSaveSnapshot(1);
    await expect(
      handler.handle({
        kind: 'persistence-save-frozen',
        payload: { snapshot: frozen },
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ checkpoint: { commitSequence: 1, worldRevision: 1 } });
    await expect(
      handler.handle({
        kind: 'persistence-ensure',
        payload: { key: '0,0,0', cx: 0, cy: 0, cz: 0 },
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ key: '0,0,0', status: 'found', snapshot: { revision: 1 } });

    await handler.handle({
      kind: 'persistence-close',
      payload: {},
      signal: new AbortController().signal,
    });
    const reopened = await FileGamePersistence.open({
      directory,
      seedText: 'handler-world',
      generatorVersion: GENERATOR_VERSION,
    });
    expect(reopened.loadGameCheckpoint()).toEqual({ commitSequence: 1, worldRevision: 1 });
    await reopened.close();
  });

  it('拒绝未握手、身份错误和关闭后的业务请求', async () => {
    const directory = await temporaryWorld();
    const store = await FileGamePersistence.open({
      directory,
      seedText: 'handler-gate',
      generatorVersion: GENERATOR_VERSION,
    });
    const handler = createPersistenceLaneRequestHandler({
      store,
      identity: { worldId: 'default', seedText: 'handler-gate', generatorVersion: GENERATOR_VERSION },
    });
    const signal = new AbortController().signal;

    await expect(
      handler.handle({
        kind: 'persistence-ensure',
        payload: { key: '0,0,0', cx: 0, cy: 0, cz: 0 },
        signal,
      }),
    ).rejects.toThrow(/握手|open/);
    await expect(
      handler.handle({
        kind: 'persistence-open',
        payload: {
          version: PERSISTENCE_LANE_PROTOCOL_VERSION,
          identity: { worldId: 'default', seedText: 'wrong', generatorVersion: GENERATOR_VERSION },
        },
        signal,
      }),
    ).rejects.toThrow(/身份/);
    await handler.handle({
      kind: 'persistence-open',
      payload: {
        version: PERSISTENCE_LANE_PROTOCOL_VERSION,
        identity: { worldId: 'default', seedText: 'handler-gate', generatorVersion: GENERATOR_VERSION },
      },
      signal,
    });
    await handler.handle({ kind: 'persistence-close', payload: {}, signal });
    await expect(
      handler.handle({
        kind: 'persistence-ensure',
        payload: { key: '0,0,0', cx: 0, cy: 0, cz: 0 },
        signal,
      }),
    ).rejects.toThrow(/关闭/);
  });

  it('合并同 key 的并行 prepare，让重叠 neighborhood 调用各自取得克隆', async () => {
    const saved: ChunkSnapshot = {
      key: '0,0,0',
      cx: 0,
      cy: 0,
      cz: 0,
      seedText: 'overlap-world',
      generatorVersion: GENERATOR_VERSION,
      revision: 3,
      voxels: Uint16Array.from({ length: 32 ** 3 }, (_, index) => (index === 0 ? Voxel.Wood : Voxel.Air)),
    };
    let resident: ChunkSnapshot | null = saved;
    const store = {
      ensureSnapshot: async () => {},
      ensureSnapshotMeasured: async () => ({ status: 'found', transactionReadMs: 1, decodeMs: 1 }),
      loadSnapshot: () => (resident ? structuredClone(resident) : null),
      evictSnapshot: () => {
        resident = null;
      },
      loadGameplaySnapshot: () => null,
      loadGameCheckpoint: () => null,
      saveFrozenSnapshot: async () => {},
      inspectPreviousCheckpoint: async () => null,
      close: async () => {},
    };
    const handler = createPersistenceLaneRequestHandler({
      store: store as never,
      identity: { worldId: 'default', seedText: 'overlap-world', generatorVersion: GENERATOR_VERSION },
    });
    const signal = new AbortController().signal;
    await handler.handle({
      kind: 'persistence-open',
      payload: {
        version: PERSISTENCE_LANE_PROTOCOL_VERSION,
        identity: { worldId: 'default', seedText: 'overlap-world', generatorVersion: GENERATOR_VERSION },
      },
      signal,
    });

    const [left, right] = await Promise.all([
      handler.handle({
        kind: 'persistence-ensure',
        payload: { key: '0,0,0', cx: 0, cy: 0, cz: 0 },
        signal,
      }),
      handler.handle({
        kind: 'persistence-ensure',
        payload: { key: '0,0,0', cx: 0, cy: 0, cz: 0 },
        signal,
      }),
    ]);
    expect(left).toMatchObject({ status: 'found', snapshot: { revision: 3 } });
    expect(right).toMatchObject({ status: 'found', snapshot: { revision: 3 } });
    expect((left as { snapshot: ChunkSnapshot }).snapshot).not.toBe((right as { snapshot: ChunkSnapshot }).snapshot);
  });
});
