import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserChunkPersistence } from '../../../src/client/persistence/browser-chunk-persistence';
import { CHUNK_SIZE, GENERATOR_VERSION, chunkKey } from '@seedlands/stdlib/world/voxel';
import type { ChunkSnapshot } from '@seedlands/stdlib/server/persistence/chunk-persistence';
import { classicWorldgenIdentity } from '@seedlands/playbook-classic/worldgen';

afterEach(() => vi.unstubAllGlobals());
type Coordinate = { cx: number; cy: number; cz: number };
const found = (coordinate: Coordinate, revision: number) => ({
  status: 'found',
  ...coordinate,
  key: chunkKey(coordinate.cx, coordinate.cy, coordinate.cz),
  revision,
  codec: 'raw-v1',
  recordBytes: 65536,
  decodeMs: 0,
  voxels: new Uint16Array(CHUNK_SIZE ** 3).buffer,
  fluidVersion: 1,
  fluid: new Uint8Array(CHUNK_SIZE ** 3).buffer,
});
class FakePersistenceWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  singleLoadRevision = 0;
  singleLoadCount = 0;
  deferSingleLoad = false;
  deferredSingles: { requestId: number; coordinate: Coordinate }[] = [];
  private respond(requestId: number, result: unknown) {
    queueMicrotask(() => this.onmessage?.({ data: { requestId, ok: true, result } } as MessageEvent));
  }
  postMessage(message: Record<string, unknown>) {
    const requestId = message.requestId as number;
    if (message.kind === 'init') {
      this.respond(requestId, {
        worldId: 'stored-sky-test',
        generatorVersion: GENERATOR_VERSION,
        provider: message.provider,
        player: null,
        gameplaySnapshot: null,
        corpusSummary: null,
        legacyMigrated: true,
      });
    } else if (message.kind === 'load') {
      this.singleLoadCount++;
      const coordinate = { cx: message.cx as number, cy: message.cy as number, cz: message.cz as number };
      if (this.deferSingleLoad) this.deferredSingles.push({ requestId, coordinate });
      else
        this.respond(
          requestId,
          this.singleLoadRevision ? found(coordinate, this.singleLoadRevision) : { status: 'missing' },
        );
    } else if (message.kind === 'save') {
      const snapshots = message.snapshots as { key: string; revision: number }[];
      this.respond(requestId, {
        saved: snapshots.map(({ key, revision }) => ({ key, revision })),
        recordBytes: 0,
        encodeMs: 0,
        codecs: {},
      });
    } else throw new Error('Unexpected Sky persistence request: ' + String(message.kind));
  }
  resolveDeferredSingle(index: number, revision: number) {
    const deferred = this.deferredSingles[index]!;
    this.respond(deferred.requestId, found(deferred.coordinate, revision));
  }
  terminate() {}
}
const open = async (worker: FakePersistenceWorker) => {
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        return worker;
      }
    },
  );
  return BrowserChunkPersistence.open('stored-sky-test', {
    databaseName: 'stored-sky-test',
    provider: classicWorldgenIdentity,
  });
};
const snapshot = (seedText: string, revision: number): ChunkSnapshot => ({
  key: '0,0,0',
  seedText,
  revision,
  generatorVersion: GENERATOR_VERSION,
  cx: 0,
  cy: 0,
  cz: 0,
  voxels: new Uint16Array(CHUNK_SIZE ** 3),
});

describe('nonconsuming durable Sky snapshots', () => {
  it('reads an exclusive durable copy while preserving an already prepared load', async () => {
    const worker = new FakePersistenceWorker();
    worker.singleLoadRevision = 7;
    const persistence = await open(worker);
    try {
      await persistence.ensureSnapshot(0, 3, 0);
      expect(persistence.preparedSnapshotStatus('0,3,0')).toBe('found');
      const source = await persistence.readStoredSkySnapshot(0, 3, 0, 7);
      expect(source?.revision).toBe(7);
      expect(worker.singleLoadCount).toBe(2);
      source!.voxels[0] = 3;
      expect(persistence.preparedSnapshotStatus('0,3,0')).toBe('found');
      expect(persistence.loadSnapshot('0,3,0')?.voxels[0]).toBe(0);
    } finally {
      persistence.dispose();
    }
  });
  it('keeps missing and mismatched durable revisions unknown without preparing a cache entry', async () => {
    const worker = new FakePersistenceWorker();
    const persistence = await open(worker);
    try {
      expect(await persistence.readStoredSkySnapshot(0, 3, 0, 7)).toBeNull();
      worker.singleLoadRevision = 8;
      expect(await persistence.readStoredSkySnapshot(0, 3, 0, 7)).toBeNull();
      expect(persistence.preparedSnapshotStatus('0,3,0')).toBe('unknown');
    } finally {
      persistence.dispose();
    }
  });
  it('discards a durable reply when a save starts during its read', async () => {
    const worker = new FakePersistenceWorker();
    worker.deferSingleLoad = true;
    const persistence = await open(worker);
    try {
      const pending = persistence.readStoredSkySnapshot(0, 3, 0, 7);
      expect(worker.deferredSingles).toHaveLength(1);
      await persistence.saveSnapshots([snapshot(persistence.seedText, 2)]);
      worker.resolveDeferredSingle(0, 7);
      expect(await pending).toBeNull();
      expect(persistence.preparedSnapshotStatus('0,3,0')).toBe('unknown');
    } finally {
      persistence.dispose();
    }
  });
});
