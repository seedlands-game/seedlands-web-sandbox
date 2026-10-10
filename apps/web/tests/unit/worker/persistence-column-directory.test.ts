import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { classicWorldgenIdentity } from '@seedlands/playbook-classic/worldgen';
import { createStoredChunkRecord } from '@seedlands/stdlib/world/chunk-snapshot-codec';
import { CHUNK_SIZE } from '@seedlands/stdlib/world/voxel';
import { persistChunkSnapshots } from '../../../src/worker/persistence-save';
import { inspectPersistenceColumnDirectory } from '../../../src/worker/persistence-column-directory';
import { openPersistenceDatabase, persistenceTransactionDone } from '../../../src/worker/persistence-indexeddb';

const config = {
  worldId: 'column-world',
  seedText: 'column-seed',
  generatorVersion: 11,
  provider: classicWorldgenIdentity,
};
let database: IDBDatabase;
const row = (cy: number, cx = -2, cz = 3, worldId = config.worldId) =>
  createStoredChunkRecord({
    ...config,
    worldId,
    cx,
    cy,
    cz,
    revision: 7,
    formatVersion: 1,
    voxelSchemaVersion: 1,
    voxels: new Uint16Array(CHUNK_SIZE ** 3),
    proceduralVoxels: new Uint16Array(CHUNK_SIZE ** 3),
  });
async function store(rows: ReturnType<typeof row>[] = [], world: unknown = { ...config, chunkDirectoryRevision: 2 }) {
  const transaction = database.transaction(['worlds', 'chunks'], 'readwrite');
  const done = persistenceTransactionDone(transaction);
  transaction.objectStore('worlds').clear();
  if (world) transaction.objectStore('worlds').put(world);
  transaction.objectStore('chunks').clear();
  for (const entry of rows) transaction.objectStore('chunks').put(entry);
  await done;
}
const inspect = (limits?: { maxEntries: number; maxVisits: number }) =>
  inspectPersistenceColumnDirectory(database, config, -2, 3, limits);
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  database = await openPersistenceDatabase('column-tests');
  await store();
});
afterEach(() => {
  database.close();
  vi.unstubAllGlobals();
});

describe('durable column directory point-in-time query', () => {
  it('includes all signed heights while excluding other world/x/z without decoding or requiring payloads', async () => {
    await store([row(-10000), row(0), row(10000), row(0, -1), row(0, -2, 4), row(0, -2, 3, 'other-world')]);
    expect(await inspect()).toEqual({
      status: 'complete',
      revision: 2,
      entries: [-10000, 0, 10000].map((cy) => ({ cx: -2, cy, cz: 3, key: `-2,${cy},3`, revision: 7 })),
    });
  });
  it('proves an empty column only with a valid current directory source', async () => {
    expect(await inspect()).toEqual({ status: 'complete', revision: 2, entries: [] });
    await store([], { ...config, chunkDirectoryRevision: 0 });
    expect(await inspect()).toEqual({ status: 'complete', revision: 0, entries: [] });
  });
  it.each([undefined, null, -1, 1.5, Number.NaN, '2'])(
    'legacy or invalid directory %s never proves empty',
    async (revision) => {
      await store([], { ...config, chunkDirectoryRevision: revision });
      expect(await inspect()).toMatchObject({ status: 'unknown' });
    },
  );
  it('missing world or changed composition identity cannot prove empty', async () => {
    await store([], null);
    expect(await inspect()).toMatchObject({ status: 'unknown' });
    await store([], { ...config, seedText: 'wrong', chunkDirectoryRevision: 2 });
    expect(await inspect()).toMatchObject({ status: 'unknown' });
    await store([], {
      ...config,
      provider: { ...classicWorldgenIdentity, artifactIdentity: 'wrong' },
      chunkDirectoryRevision: 2,
    });
    expect(await inspect()).toMatchObject({ status: 'unknown' });
  });
  it('malformed provider metadata is unknown rather than a complete empty column', async () => {
    await store([], { ...config, provider: {}, chunkDirectoryRevision: 2 });
    expect(await inspect()).toEqual({ status: 'unknown', reason: 'invalid-data' });
  });
  it('exact entry budget remains complete but overflow has no partial entries', async () => {
    await store([row(0), row(1)]);
    expect(await inspect({ maxEntries: 2, maxVisits: 8 })).toMatchObject({
      status: 'complete',
      entries: [row(0), row(1)].map(({ cx, cy, cz, revision }) => ({ cx, cy, cz, key: `${cx},${cy},${cz}`, revision })),
    });
    expect(await inspect({ maxEntries: 1, maxVisits: 8 })).toEqual({ status: 'unknown', reason: 'budget-exhausted' });
  });
  it('visited-key budget is bounded even when no keys match cz', async () => {
    await store([row(0, -2, 4), row(1, -2, 4), row(2, -2, 4)]);
    expect(await inspect({ maxEntries: 2, maxVisits: 2 })).toEqual({ status: 'unknown', reason: 'budget-exhausted' });
    expect(await inspect({ maxEntries: 2, maxVisits: 3 })).toEqual({ status: 'complete', revision: 2, entries: [] });
  });
  it.each([{ revision: -1 }, { generatorVersion: 12 }, { seedText: 'wrong' }, { cy: 0.5 }])(
    'bad row %j is unknown',
    async (change) => {
      await store([{ ...row(0), ...change }]);
      expect(await inspect()).toEqual({ status: 'unknown', reason: 'invalid-data' });
    },
  );
  it('queries the actual save producer record shape rather than a directory-only fixture', async () => {
    await persistChunkSnapshots({
      database: async () => database,
      config,
      snapshots: [
        { cx: -2, cy: 4096, cz: 3, key: '-2,4096,3', revision: 7, voxels: new Uint16Array(CHUNK_SIZE ** 3).buffer },
      ],
      normalizeRecord: (value) => value as ReturnType<typeof row>,
      proceduralChunk: () => new Uint16Array(CHUNK_SIZE ** 3),
    });
    expect(await inspect()).toEqual({
      status: 'complete',
      revision: 3,
      entries: [{ cx: -2, cy: 4096, cz: 3, key: '-2,4096,3', revision: 7 }],
    });
  });
  it('observes a new transaction revision without retaining prior key results', async () => {
    await store([row(0)]);
    expect(await inspect()).toMatchObject({ revision: 2 });
    await store([row(10000)], { ...config, chunkDirectoryRevision: 3 });
    expect(await inspect()).toEqual({
      status: 'complete',
      revision: 3,
      entries: [{ cx: -2, cy: 10000, cz: 3, key: '-2,10000,3', revision: 7 }],
    });
  });
  it('rejects invalid coordinates and limits before opening an IndexedDB transaction', async () => {
    const transaction = vi.spyOn(database, 'transaction');
    await expect(inspectPersistenceColumnDirectory(database, config, Number.NaN, 3)).rejects.toThrow();
    await expect(inspect({ maxEntries: 0, maxVisits: 1 })).rejects.toThrow();
    await expect(inspect({ maxEntries: 129, maxVisits: 2048 })).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
});
