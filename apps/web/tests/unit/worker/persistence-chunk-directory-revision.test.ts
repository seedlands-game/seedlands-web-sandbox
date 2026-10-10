import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import type { StoredChunkRecord } from '@seedlands/stdlib/world/chunk-snapshot-codec';
import { CHUNK_SIZE } from '@seedlands/stdlib/world/voxel';
import { persistChunkSnapshots } from '../../../src/worker/persistence-save';
import { seedPersistenceCorpus } from '../../../src/worker/persistence-seed-corpus';
import { classicWorldgenIdentity } from '@seedlands/playbook-classic/worldgen';
import { deleteStoredWorld } from '../../../src/worker/persistence-world-directory';
import { persistFrozenGameSnapshot, type FrozenSaveTaskSnapshot } from '../../../src/worker/persistence-frozen-save';
import {
  openPersistenceDatabase,
  persistenceTransactionDone,
  requestPersistenceResult,
} from '../../../src/worker/persistence-indexeddb';

const config = { worldId: 'directory-world', seedText: 'directory-seed', generatorVersion: 11 };
const empty = () => new Uint16Array(CHUNK_SIZE ** 3);
const baseWorld = { ...config, player: [1, 2, 3], updatedAt: 17, commitSequence: 8, worldRevision: 4 };
const snapshot = (cy = 0, revision = 1, value = 1) => {
  const voxels = empty();
  voxels[0] = value;
  return { key: `0,${cy},0`, cx: 0, cy, cz: 0, revision, voxels: voxels.buffer };
};
const frozen = (chunks = [snapshot()], commitSequence = 9): FrozenSaveTaskSnapshot => ({
  version: 1,
  seedText: config.seedText,
  generatorVersion: config.generatorVersion,
  worldRevision: 5,
  commitSequence,
  physicsSchema: { version: 1, bodyRegistryVersion: 1 },
  fluidSchema: { version: 1, encoding: 'chunk-level-source-byte' },
  // This I/O fixture treats gameplay as opaque. Gameplay validation belongs to Authority.
  gameplay: { fixture: 'checkpoint' } as never,
  chunks,
});

let database: IDBDatabase;
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  database = await openPersistenceDatabase('directory-tests');
  const transaction = database.transaction('worlds', 'readwrite');
  const done = persistenceTransactionDone(transaction);
  transaction.objectStore('worlds').put(baseWorld);
  await done;
});
afterEach(() => {
  database.close();
  vi.unstubAllGlobals();
});

async function state() {
  const transaction = database.transaction(['worlds', 'chunks'], 'readonly');
  const done = persistenceTransactionDone(transaction);
  const [world, chunks] = await Promise.all([
    requestPersistenceResult(transaction.objectStore('worlds').get(config.worldId)),
    requestPersistenceResult(transaction.objectStore('chunks').getAll()),
  ]);
  await done;
  return { world, chunks: chunks as StoredChunkRecord[] };
}
async function setRevision(value: unknown) {
  const transaction = database.transaction('worlds', 'readwrite');
  const done = persistenceTransactionDone(transaction);
  transaction.objectStore('worlds').put({ ...baseWorld, chunkDirectoryRevision: value });
  await done;
}
const save = (snapshots = [snapshot()], normalizeRecord = (value: unknown) => value as StoredChunkRecord) =>
  persistChunkSnapshots({
    database: () => Promise.resolve(database),
    config,
    snapshots,
    proceduralChunk: empty,
    normalizeRecord,
  });
const saveFrozen = (snapshot: FrozenSaveTaskSnapshot, replace = false) =>
  persistFrozenGameSnapshot({
    database,
    config,
    snapshot,
    replace,
    proceduralChunk: empty,
    normalizeRecord: (value) => value as StoredChunkRecord,
  });

describe('same-transaction persisted chunk directory revision', () => {
  it('普通保存从旧记录0开始推进目录版本且保留原checkpoint与其他metadata', async () => {
    await save();
    expect((await state()).world).toEqual({ ...baseWorld, chunkDirectoryRevision: 1 });
    await save([snapshot(128, 1)]);
    const current = await state();
    expect(current.world).toEqual({ ...baseWorld, chunkDirectoryRevision: 2 });
    expect(current.chunks.map(({ cy }) => cy)).toEqual([0, 128]);
  });
  it('没有区块变化的空保存不伪造目录失效', async () => {
    await save([]);
    expect(await state()).toEqual({ world: baseWorld, chunks: [] });
  });
  it('同数据库并发save经同一worlds/chunks事务串行，不丢目录增长', async () => {
    await Promise.all([save(), save([snapshot(128)])]);
    const current = await state();
    expect(current.world.chunkDirectoryRevision).toBe(2);
    expect(current.chunks.map(({ cy }) => cy)).toEqual([0, 128]);
  });
  it('世界删除后metadata与chunks一起消失，旧owner不能保存并复活它', async () => {
    await save([snapshot(128)]);
    await deleteStoredWorld('directory-tests', config.worldId);
    expect(await state()).toEqual({ world: undefined, chunks: [] });
    await expect(save()).rejects.toThrow(/metadata is missing/);
    expect(await state()).toEqual({ world: undefined, chunks: [] });
  });
  it('最大有效目录版本不绕回或损失整数精度', async () => {
    await setRevision(Number.MAX_SAFE_INTEGER - 1);
    await save();
    const current = await state();
    expect(current.world.chunkDirectoryRevision).toBe(Number.MAX_SAFE_INTEGER);
    await expect(save([snapshot(128)])).rejects.toThrow(/directory revision/i);
    expect(await state()).toEqual(current);
  });
  it('后续record解码失败时，已排队的首个put和目录版本整体回滚', async () => {
    await save([snapshot(128)]);
    const before = await state();
    await expect(
      save([snapshot(), snapshot(128, 2)], () => {
        throw new Error('damaged existing record');
      }),
    ).rejects.toThrow('damaged existing record');
    expect(await state()).toEqual(before);
  });
  it('相同revision不同内容冲突时保留旧目录与所有区块', async () => {
    await save([snapshot(128)]);
    const before = await state();
    await expect(save([snapshot(), snapshot(128, 1, 2)])).rejects.toThrow(/conflicts/);
    expect(await state()).toEqual(before);
  });
  it.each([-1, 1.5, NaN, null, '1', Number.MAX_SAFE_INTEGER])('坏目录版本/溢出%j拒绝且不部分写入', async (value) => {
    await setRevision(value);
    const before = await state();
    await expect(save()).rejects.toThrow(/directory revision/i);
    expect(await state()).toEqual(before);
  });
  it('frozen保存增长目录版本并保留既有player字段', async () => {
    await saveFrozen(frozen());
    const current = await state();
    expect(current.world).toMatchObject({
      player: baseWorld.player,
      commitSequence: 9,
      worldRevision: 5,
      chunkDirectoryRevision: 1,
    });
    expect(current.chunks).toHaveLength(1);
  });
  it('只保存gameplay checkpoint的空frozen不增加区块目录版本', async () => {
    await save();
    await saveFrozen(frozen([]));
    expect((await state()).world).toMatchObject({ commitSequence: 9, worldRevision: 5, chunkDirectoryRevision: 1 });
  });
  it('replace删除未驻留高层旧区块并增长同一世界目录版本', async () => {
    await save([snapshot(128)]);
    await saveFrozen(frozen(), true);
    const current = await state();
    expect(current.world.chunkDirectoryRevision).toBe(2);
    expect(current.chunks.map(({ cy }) => cy)).toEqual([0]);
  });
  it('frozen冲突和坏目录版本均不提前提交区块/checkpoint', async () => {
    await save([snapshot(128)]);
    const before = await state();
    await expect(saveFrozen(frozen([snapshot(), snapshot(128, 1, 2)]))).rejects.toThrow(/conflicts/);
    expect(await state()).toEqual(before);
    await setRevision(Number.MAX_SAFE_INTEGER);
    const overflowing = await state();
    await expect(saveFrozen(frozen(), true)).rejects.toThrow(/directory revision/i);
    expect(await state()).toEqual(overflowing);
  });
  it('seed corpus的clear及每批写入都推进目录版本，末尾metadata不能丢弃它', async () => {
    await save([snapshot(128)]);
    const summary = await seedPersistenceCorpus({
      database,
      config: { ...config, provider: classicWorldgenIdentity },
      chunkCount: 33,
      proceduralChunk: empty,
    });
    const current = await state();
    expect(current.world.chunkDirectoryRevision).toBe(4); // save + clear + two batches
    expect(current.chunks).toHaveLength(33);
    expect(current.chunks.every(({ cy }) => cy === 0)).toBe(true);
    expect(current.world.corpusSummary).toEqual(summary);
    expect(current.world.commitSequence).toBeUndefined(); // Preserve the original corpus reset contract.
  });
});
