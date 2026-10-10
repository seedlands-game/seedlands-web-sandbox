import { describe, expect, it, vi } from 'vitest';
import { MemoryChunkPersistence } from '../../src/server/persistence/memory-chunk-persistence';
import type { ChunkSnapshot } from '../../src/server/persistence/chunk-persistence';

const snapshot = (cy = 0, cx = 2, cz = -3): ChunkSnapshot => ({
  cx,
  cy,
  cz,
  key: `${cx},${cy},${cz}`,
  revision: 4,
  seedText: 'directory',
  generatorVersion: 1,
  voxels: new Uint16Array([5]),
  fluid: new Uint8Array([1]),
});

describe('Memory owner column directory', () => {
  it('starts complete empty and indexes signed high columns without loading payloads', async () => {
    const owner = new MemoryChunkPersistence();
    expect(await owner.inspectColumnDirectory(2, -3)).toEqual({ status: 'complete', revision: 0, entries: [] });
    owner.saveSnapshots([snapshot(-10000), snapshot(10000), snapshot(9, 3)]);
    const load = vi.spyOn(owner, 'loadSnapshot');
    expect(await owner.inspectColumnDirectory(2, -3)).toEqual({
      status: 'complete',
      revision: 1,
      entries: [-10000, 10000].map((cy) => ({ cx: 2, cy, cz: -3, key: `2,${cy},-3`, revision: 4 })),
    });
    expect(load).not.toHaveBeenCalled();
  });
  it('returns detached metadata, keeps snapshot clones, and empty saves do not advance', async () => {
    const owner = new MemoryChunkPersistence();
    const input = snapshot();
    owner.saveSnapshots([input]);
    input.voxels[0] = 9;
    owner.saveSnapshots([]);
    const first = await owner.inspectColumnDirectory(2, -3);
    if (first.status !== 'complete') throw new Error('Expected complete');
    Object.assign(first.entries[0], { revision: 99 });
    expect(await owner.inspectColumnDirectory(2, -3)).toMatchObject({ revision: 1, entries: [{ revision: 4 }] });
    expect(owner.loadSnapshot(input.key)?.voxels[0]).toBe(5);
    owner.saveSnapshots([{ ...snapshot(), revision: 6 }]);
    expect(await owner.inspectColumnDirectory(2, -3)).toMatchObject({ revision: 2, entries: [{ revision: 6 }] });
    expect(owner.writes).toEqual([input.key, input.key]);
  });
  it('clone failure does not change prior snapshots, directory, or write history', async () => {
    const owner = new MemoryChunkPersistence();
    owner.saveSnapshots([snapshot()]);
    const bad = snapshot(2);
    vi.spyOn(bad.voxels, 'slice').mockImplementation(() => {
      throw new Error('clone failed');
    });
    const pending = owner.inspectColumnDirectory(2, -3);
    expect(() => owner.saveSnapshots([snapshot(1), bad])).toThrow('clone failed');
    expect(await pending).toMatchObject({ status: 'complete', revision: 1 });
    expect(await owner.inspectColumnDirectory(2, -3)).toMatchObject({ revision: 1, entries: [{ cy: 0 }] });
    expect(owner.loadSnapshot('2,1,-3')).toBeNull();
    expect(owner.writes).toEqual(['2,0,-3']);
  });
  it.each([{ key: '02,0,-3' }, { cx: 7 }, { revision: -1 }, { revision: NaN }])(
    'damaged record remains unknown: %o',
    async (damage) => {
      const owner = new MemoryChunkPersistence();
      owner.saveSnapshots([{ ...snapshot(), ...damage }]);
      expect(await owner.inspectColumnDirectory(2, -3)).toEqual({ status: 'unknown', reason: 'invalid-data' });
    },
  );
  it('returns no partial result beyond 128 entries', async () => {
    const owner = new MemoryChunkPersistence();
    owner.saveSnapshots(Array.from({ length: 128 }, (_, cy) => snapshot(cy)));
    expect(await owner.inspectColumnDirectory(2, -3)).toMatchObject({ status: 'complete', entries: expect.any(Array) });
    owner.saveSnapshots([snapshot(128)]);
    expect(await owner.inspectColumnDirectory(2, -3)).toEqual({ status: 'unknown', reason: 'budget-exhausted' });
  });
  it('revision exhaustion rejects before any stored snapshot or write changes', async () => {
    const owner = new MemoryChunkPersistence();
    owner.saveSnapshots([snapshot()]);
    Object.assign(owner, { directoryRevision: Number.MAX_SAFE_INTEGER });
    expect(() => owner.saveSnapshots([snapshot(1)])).toThrow('revision exhausted');
    expect(owner.loadSnapshot('2,1,-3')).toBeNull();
    expect(owner.writes).toEqual(['2,0,-3']);
    expect(await owner.inspectColumnDirectory(2, -3)).toMatchObject({ revision: Number.MAX_SAFE_INTEGER });
  });
  it('rejects invalid coordinates and supersedes a pending observation after a write', async () => {
    const owner = new MemoryChunkPersistence();
    await expect(owner.inspectColumnDirectory(NaN, 0)).rejects.toThrow(RangeError);
    const pending = owner.inspectColumnDirectory(2, -3);
    owner.saveSnapshots([snapshot()]);
    expect(await pending).toEqual({ status: 'unknown', reason: 'superseded' });
  });
});
