import { describe, expect, it } from 'vitest';
import { ChunkSaveCoordinator, type PendingChunkSave } from '../../src/server/persistence/chunk-save-coordinator';

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void };

const deferred = (): Deferred => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

const snapshot = (revision: number) => ({
  key: '0,0,0',
  revision,
  voxels: new Uint16Array(32 ** 3).fill(revision),
});

describe('Chunk save coordinator', () => {
  it('keeps R+1 dirty when the ACK for an in-flight R save arrives', async () => {
    const firstWrite = deferred();
    const writes: number[] = [];
    const coordinator = new ChunkSaveCoordinator({
      save: async (value: PendingChunkSave) => {
        writes.push(value.revision);
        if (value.revision === 1) await firstWrite.promise;
      },
    });

    coordinator.enqueue(snapshot(1));
    const firstFlush = coordinator.flush();
    coordinator.enqueue(snapshot(2));
    firstWrite.resolve();
    await firstFlush;

    expect(coordinator.state('0,0,0')).toMatchObject({
      revision: 2,
      persistedRevision: 1,
      dirty: true,
    });
    await coordinator.flush();
    expect(writes).toEqual([1, 2]);
    expect(coordinator.state('0,0,0')).toMatchObject({ persistedRevision: 2, dirty: false });
  });

  it('ignores an old ACK and never lets an older record replace a newer revision', async () => {
    const coordinator = new ChunkSaveCoordinator({ save: async () => undefined });
    coordinator.enqueue(snapshot(4));
    await coordinator.flush();
    coordinator.acknowledge('0,0,0', 2);

    expect(coordinator.state('0,0,0')).toMatchObject({ revision: 4, persistedRevision: 4, dirty: false });
    expect(() => coordinator.enqueue(snapshot(3))).toThrow(/revision|older|stale/i);
  });

  it('retains dirty state after a persistence failure', async () => {
    const coordinator = new ChunkSaveCoordinator({
      save: async () => {
        throw new Error('simulated IndexedDB failure');
      },
    });
    coordinator.enqueue(snapshot(1));

    await expect(coordinator.flush()).rejects.toThrow('simulated IndexedDB failure');
    expect(coordinator.state('0,0,0')).toMatchObject({ revision: 1, persistedRevision: 0, dirty: true });
  });

  it('rechecks revision, lease and eviction epoch after an asynchronous save', async () => {
    const write = deferred();
    const coordinator = new ChunkSaveCoordinator({ save: async () => write.promise });
    coordinator.enqueue(snapshot(1));
    const eviction = coordinator.requestEviction('0,0,0');
    coordinator.enqueue(snapshot(2));
    const lease = coordinator.acquireLease('0,0,0');
    write.resolve();

    await expect(eviction).resolves.toBe(false);
    lease.release();
    expect(coordinator.state('0,0,0')).toMatchObject({ revision: 2, dirty: true, evicted: false });
  });
});
