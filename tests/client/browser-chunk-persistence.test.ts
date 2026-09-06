import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserChunkPersistence } from '../../src/client/browser-chunk-persistence';
import type { ChunkSnapshot } from '../../src/server/persistence/chunk-persistence';
import { CHUNK_SIZE, GENERATOR_VERSION, chunkKey } from '../../src/world/voxel';

type Coordinate = Readonly<{ cx: number; cy: number; cz: number }>;
type DeferredBatch = Readonly<{ requestId: number; coordinates: readonly Coordinate[] }>;

const found = ({ cx, cy, cz }: Coordinate, revision = 1) => ({
  status: 'found' as const,
  key: chunkKey(cx, cy, cz),
  cx,
  cy,
  cz,
  revision,
  codec: 'raw-v1',
  recordBytes: CHUNK_SIZE ** 3 * Uint16Array.BYTES_PER_ELEMENT,
  decodeMs: 0.25,
  voxels: new Uint16Array(CHUNK_SIZE ** 3).buffer,
  fluidVersion: 1 as const,
  fluid: new Uint8Array(CHUNK_SIZE ** 3).buffer,
});

class FakePersistenceWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  singleLoadCount = 0;
  readonly batchRequestSizes: number[] = [];
  readonly deferredBatches: DeferredBatch[] = [];
  batchMode: 'missing' | 'found' | 'mismatch' | 'error' | 'deferred' = 'missing';
  singleLoadRevision = 0;
  failNextSave = false;

  private respond(requestId: number, result: unknown) {
    queueMicrotask(() => this.onmessage?.({ data: { requestId, ok: true, result } } as MessageEvent));
  }

  private reject(requestId: number, error: string) {
    queueMicrotask(() => this.onmessage?.({ data: { requestId, ok: false, error } } as MessageEvent));
  }

  postMessage(message: Record<string, unknown>) {
    const requestId = message.requestId as number;
    if (message.kind === 'init') {
      this.respond(requestId, {
        worldId: 'test-world',
        generatorVersion: GENERATOR_VERSION,
        player: null,
        gameplaySnapshot: null,
        corpusSummary: null,
        legacyMigrated: true,
      });
      return;
    }
    if (message.kind === 'load') {
      this.singleLoadCount += 1;
      const coordinate = message as unknown as Coordinate;
      this.respond(
        requestId,
        this.singleLoadRevision ? found(coordinate, this.singleLoadRevision) : { status: 'missing' },
      );
      return;
    }
    if (message.kind === 'load-batch') {
      const coordinates = message.coordinates as Coordinate[];
      this.batchRequestSizes.push(coordinates.length);
      if (this.batchMode === 'deferred') {
        this.deferredBatches.push({ requestId, coordinates });
        return;
      }
      if (this.batchMode === 'error') {
        this.batchMode = 'missing';
        this.reject(requestId, 'batch read failed');
        return;
      }
      const result = coordinates.map((coordinate) =>
        this.batchMode === 'missing' ? { status: 'missing' } : found(coordinate),
      );
      if (this.batchMode === 'mismatch') result[result.length - 1] = found({ cx: 999, cy: 1, cz: -2 });
      this.respond(requestId, result);
      return;
    }
    if (message.kind === 'save' || message.kind === 'save-frozen') {
      if (this.failNextSave) {
        this.failNextSave = false;
        this.reject(requestId, 'save failed');
      } else {
        const snapshots =
          message.kind === 'save'
            ? (message.snapshots as Array<{ key: string; revision: number }>)
            : ((message.snapshot as { chunks: Array<{ key: string; revision: number }> }).chunks ?? []);
        this.respond(requestId, {
          saved: snapshots.map(({ key, revision }) => ({ key, revision })),
          recordBytes: 0,
          encodeMs: 0,
          codecs: {},
        });
      }
      return;
    }
    throw new Error(`Unexpected persistence request: ${String(message.kind)}`);
  }

  resolveDeferredBatch(index: number, mode: 'missing' | 'found' = 'missing') {
    const batch = this.deferredBatches[index]!;
    this.respond(
      batch.requestId,
      batch.coordinates.map((coordinate) => (mode === 'found' ? found(coordinate) : { status: 'missing' })),
    );
  }

  terminate() {}
}

const open = async (worker: FakePersistenceWorker, seed = 'persistence-test') => {
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        return worker;
      }
    },
  );
  return BrowserChunkPersistence.open(seed, { databaseName: 'test' });
};

const snapshot = (seedText: string, revision: number): ChunkSnapshot => ({
  key: chunkKey(0, 0, 0),
  seedText,
  generatorVersion: GENERATOR_VERSION,
  cx: 0,
  cy: 0,
  cz: 0,
  revision,
  voxels: new Uint16Array(CHUNK_SIZE ** 3),
});

describe('BrowserChunkPersistence neighborhood loads', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses one bounded transaction per released mesh-neighborhood preparation', async () => {
    const worker = new FakePersistenceWorker();
    const persistence = await open(worker, 'missing-halo');

    await persistence.ensureNeighborhood(0, 1, -2);
    expect(worker.singleLoadCount).toBe(0);
    expect(worker.batchRequestSizes).toEqual([27]);
    expect(persistence.metrics()).toMatchObject({ idbGetCount: 27, loadTransactionCount: 1 });
    persistence.releaseNeighborhood(0, 1, -2);
    await persistence.ensureNeighborhood(0, 1, -2);

    expect(worker.singleLoadCount).toBe(0);
    expect(worker.batchRequestSizes).toEqual([27, 27]);
    expect(persistence.metrics()).toMatchObject({ idbGetCount: 54, loadTransactionCount: 2 });
    persistence.dispose();
  });

  it('coalesces concurrent overlapping neighborhood requests through per-key in-flight ownership', async () => {
    const worker = new FakePersistenceWorker();
    const persistence = await open(worker, 'overlapping-halo');

    await Promise.all([persistence.ensureNeighborhood(0, 1, -2), persistence.ensureNeighborhood(1, 1, -2)]);

    expect(worker.singleLoadCount).toBe(0);
    expect(worker.batchRequestSizes).toEqual([27, 9]);
    expect(persistence.metrics()).toMatchObject({ idbGetCount: 36, loadTransactionCount: 2 });
    persistence.dispose();
  });

  it('publishes a batch atomically and retries after a worker or identity failure', async () => {
    const worker = new FakePersistenceWorker();
    const persistence = await open(worker, 'atomic-halo');
    worker.batchMode = 'error';
    await expect(persistence.ensureNeighborhood(0, 1, -2)).rejects.toThrow('batch read failed');
    expect(persistence.residentSnapshotCount).toBe(0);

    worker.batchMode = 'mismatch';
    await expect(persistence.ensureNeighborhood(0, 1, -2)).rejects.toThrow('does not match');
    expect(persistence.residentSnapshotCount).toBe(0);

    worker.batchMode = 'found';
    await persistence.ensureNeighborhood(0, 1, -2);
    expect(persistence.residentSnapshotCount).toBe(27);
    expect(worker.batchRequestSizes).toEqual([27, 27, 27]);
    persistence.dispose();
  });

  it('does not let a released batch repopulate cache or delete a successor ownership', async () => {
    const worker = new FakePersistenceWorker();
    worker.batchMode = 'deferred';
    const persistence = await open(worker, 'released-halo');

    const stale = persistence.ensureNeighborhood(0, 1, -2);
    persistence.releaseNeighborhood(0, 1, -2);
    const successor = persistence.ensureNeighborhood(0, 1, -2);
    expect(worker.batchRequestSizes).toEqual([27, 27]);

    worker.resolveDeferredBatch(0, 'found');
    await stale;
    expect(persistence.residentSnapshotCount).toBe(0);
    worker.resolveDeferredBatch(1, 'found');
    await successor;
    expect(persistence.residentSnapshotCount).toBe(27);
    persistence.dispose();
  });

  it('invalidates loaded snapshots only after a successful save', async () => {
    const worker = new FakePersistenceWorker();
    worker.singleLoadRevision = 1;
    const persistence = await open(worker, 'save-cache');
    await persistence.ensureSnapshot(0, 0, 0);

    worker.failNextSave = true;
    await expect(persistence.saveSnapshots([snapshot('save-cache', 2)])).rejects.toThrow('save failed');
    expect(persistence.loadSnapshot(chunkKey(0, 0, 0))?.revision).toBe(1);

    await persistence.ensureSnapshot(0, 0, 0);
    await persistence.saveSnapshots([snapshot('save-cache', 2)]);
    expect(persistence.loadSnapshot(chunkKey(0, 0, 0))).toBeNull();
    worker.singleLoadRevision = 2;
    await persistence.ensureSnapshot(0, 0, 0);
    expect(persistence.loadSnapshot(chunkKey(0, 0, 0))?.revision).toBe(2);
    persistence.dispose();
  });

  it('rejects in-flight work on dispose and ignores its late response', async () => {
    const worker = new FakePersistenceWorker();
    worker.batchMode = 'deferred';
    const persistence = await open(worker, 'disposed-halo');
    const loading = persistence.ensureNeighborhood(0, 1, -2);

    persistence.dispose();
    await expect(loading).rejects.toThrow('disposed');
    worker.resolveDeferredBatch(0, 'found');
    await Promise.resolve();
    expect(persistence.residentSnapshotCount).toBe(0);
    await expect(persistence.ensureSnapshot(0, 0, 0)).rejects.toThrow('disposed');
  });
});
