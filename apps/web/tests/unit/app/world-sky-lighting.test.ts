import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHUNK_SIZE, Voxel } from '@seedlands/stdlib/world/voxel';
import { classicContent } from '../../fixtures/classic/content';
import { WorldSkyLighting } from '../../../src/app/scene/world-sky-lighting';
import type { SkyColumnSource } from '../../../src/app/scene/sky-column-source';
import { requestBrowserSkyChunk } from '../../../src/client/authority/browser-authority-sky-chunk';
import { SKY_VISIBILITY_MAX_COLUMN_HEIGHT } from '../../../src/app/scene/sky-visibility-volume';

const complete = (revision = 0): Extract<SkyColumnSource, { status: 'complete' }> => ({
  status: 'complete',
  cx: 0,
  cz: 0,
  epoch: 1,
  worldRevision: revision,
  directoryRevision: 0,
  generatedEmptyAboveY: 51,
  entries: [],
});
const fixture = (options?: { yieldTask: () => Promise<void> }) => {
  vi.useFakeTimers();
  const authority = {
    runtimeEpoch: 'world:1',
    worldRevision: 0,
    worldTime: 9,
    voxelSemantics: classicContent.voxelSemantics,
    getVoxel: () => Voxel.Air,
    getChunkRevision: (_cx: number, _cy: number, _cz: number): number | null => 0,
    inspectColumnSource: vi.fn(async (): Promise<SkyColumnSource> => complete()),
    readSkyColumnChunk: vi.fn(
      async (
        _cx: number,
        _cy: number,
        _cz: number,
        _revision: number,
      ): Promise<{
        canonical: Uint16Array;
        revision: number;
      } | null> => null,
    ),
  };
  const light = new WorldSkyLighting(authority, options ?? { yieldTask: async () => undefined });
  const sink = { failDark: vi.fn(), publish: vi.fn(), dispose: vi.fn() };
  const release = light.register({ chunkKey: '0,0,0', cx: 0, cy: 0, cz: 0 }, sink);
  return { authority, light, sink, release };
};
afterEach(() => vi.useRealTimers());

describe('production World sky derived owner', () => {
  it('bounds repeated point sampling to the requested column independently of other ready columns', async () => {
    const { light, authority } = fixture();
    const reads = vi.fn(() => 0);
    authority.getChunkRevision = reads;
    authority.inspectColumnSource.mockImplementation(async (cx?: number, cz?: number) => ({
      ...complete(),
      cx: cx ?? 0,
      cz: cz ?? 0,
    }));
    for (let cx = 1; cx < 4; cx++)
      light.register(
        { chunkKey: `${cx},0,0`, cx, cy: 0, cz: 0 },
        { failDark: vi.fn(), publish: vi.fn(), dispose: vi.fn() },
      );
    await vi.advanceTimersByTimeAsync(64);
    expect(light.diagnostics.readyChunkKeys).toHaveLength(4);
    const counts = [];
    for (let repeat = 0; repeat < 2; repeat++) {
      reads.mockClear();
      for (let i = 0; i < 64; i++) expect(light.sample([0.5, 0.5, 0.5])).toMatchObject({ ready: true, visibility: 1 });
      counts.push(reads.mock.calls.length);
    }
    console.info('Sky point sample exact query counts:', JSON.stringify({ columns: 4, samples: 64, counts }));
    light.dispose();
    const fullColumnReads = (64 * SKY_VISIBILITY_MAX_COLUMN_HEIGHT) / CHUNK_SIZE;
    expect(counts).toEqual([fullColumnReads, fullColumnReads]);
  });

  it.each(['revision', 'residency'] as const)(
    'checks same-world-revision target column %s changes on every sample',
    async (change) => {
      const { light, authority, sink } = fixture();
      await vi.advanceTimersByTimeAsync(16);
      expect(light.sample([0.5, 0.5, 0.5])).toMatchObject({ ready: true, visibility: 1 });
      const darkCalls = sink.failDark.mock.calls.length;
      authority.getChunkRevision = (_cx, cy) => (cy === 1 ? (change === 'revision' ? 1 : null) : 0);
      expect(light.sample([0.5, 0.5, 0.5])).toMatchObject({ ready: false });
      expect(sink.failDark).toHaveBeenCalledTimes(darkCalls + 1);
      expect(authority.worldRevision).toBe(0);
      light.dispose();
    },
  );

  it.each(['frame', 'commit', 'epoch'] as const)(
    'preserves global invalidation of unsampled columns at the existing %s boundary',
    async (boundary) => {
      const { light, authority, sink } = fixture();
      const other = { failDark: vi.fn(), publish: vi.fn(), dispose: vi.fn() };
      authority.inspectColumnSource.mockImplementation(async (cx?: number, cz?: number) => ({
        ...complete(),
        cx: cx ?? 0,
        cz: cz ?? 0,
      }));
      light.register({ chunkKey: '1,0,0', cx: 1, cy: 0, cz: 0 }, other);
      await vi.advanceTimersByTimeAsync(32);
      expect(light.diagnostics.readyChunkKeys).toHaveLength(2);
      const darkCalls = sink.failDark.mock.calls.length;
      const otherDarkCalls = other.failDark.mock.calls.length;
      if (boundary === 'epoch') authority.runtimeEpoch = 'world:2';
      else if (boundary === 'frame') authority.getChunkRevision = () => null;
      if (boundary === 'commit') light.notifyCommit(1);
      else light.invalidateStale();
      expect(sink.failDark).toHaveBeenCalledTimes(darkCalls + 1);
      expect(other.failDark).toHaveBeenCalledTimes(otherDarkCalls + 1);
      expect(light.diagnostics.readyChunkKeys).toHaveLength(0);
      light.dispose();
    },
  );

  it('rebuilds a column superseded by a save without a world revision change', async () => {
    const { light, sink, authority } = fixture();
    authority.inspectColumnSource.mockResolvedValueOnce({ status: 'unknown', reason: 'superseded' });
    await vi.advanceTimersByTimeAsync(16);
    expect(sink.publish).not.toHaveBeenCalled();
    expect(light.sample([0.5, 0.5, 0.5])).toMatchObject({ ready: false });
    await vi.advanceTimersByTimeAsync(16);
    expect(authority.inspectColumnSource).toHaveBeenCalledTimes(2);
    expect(sink.publish).toHaveBeenCalledOnce();
    expect(light.sample([0.5, 0.5, 0.5])).toMatchObject({ ready: true, visibility: 1 });
    light.dispose();
  });
  it('retries a save-fenced nonresident roof through the real Sky response decoder', async () => {
    const { light, sink, authority } = fixture();
    authority.getChunkRevision = (_cx = 0, cy = 0) => (cy < 2 ? 0 : null);
    authority.inspectColumnSource.mockResolvedValue({
      ...complete(),
      entries: [{ key: '0,2,0', cx: 0, cy: 2, cz: 0, revision: 0, resident: false, dirty: false }],
    });
    const roof = new Uint16Array(32 ** 3).fill(Voxel.Stone);
    const request = vi
      .fn()
      .mockResolvedValueOnce({ status: 'unavailable', key: '0,2,0', reason: 'superseded' })
      .mockImplementation(async () => ({
        status: 'available',
        key: '0,2,0',
        chunkRevision: 0,
        canonical: roof.slice().buffer,
        fluid: new ArrayBuffer(32 ** 3),
      }));
    authority.readSkyColumnChunk.mockImplementation((cx, cy, cz, revision) =>
      requestBrowserSkyChunk(request, () => authority.runtimeEpoch, cx, cy, cz, revision),
    );
    await vi.advanceTimersByTimeAsync(16);
    expect(sink.publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(16);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith({ kind: 'request-sky-source', key: '0,2,0', minimumRevision: 0 });
    expect(sink.publish).toHaveBeenCalledOnce();
    expect(light.sample([0.5, 0.5, 0.5])).toMatchObject({ ready: true, visibility: 0 });
    expect(authority.getChunkRevision(0, 2, 0)).toBeNull();
    light.dispose();
  });
  it.each(['release', 'dispose'] as const)('cancels a superseded source retry after %s', async (action) => {
    const { light, sink, authority, release } = fixture();
    authority.inspectColumnSource.mockResolvedValueOnce({ status: 'unknown', reason: 'superseded' });
    await vi.advanceTimersByTimeAsync(16);
    if (action === 'release') release();
    else light.dispose();
    await vi.advanceTimersByTimeAsync(100);
    expect(authority.inspectColumnSource).toHaveBeenCalledOnce();
    expect(sink.publish).not.toHaveBeenCalled();
    light.dispose();
  });
  it('keeps one pending rebuild while a superseded column retry waits for its source', async () => {
    const { light, sink, authority } = fixture();
    let resolve!: (source: SkyColumnSource) => void;
    authority.inspectColumnSource
      .mockResolvedValueOnce({ status: 'unknown', reason: 'superseded' })
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
    await vi.advanceTimersByTimeAsync(32);
    for (let i = 0; i < 3; i++) light.request([0, 0, 0]);
    await vi.advanceTimersByTimeAsync(100);
    expect(authority.inspectColumnSource).toHaveBeenCalledTimes(2);
    expect(light.diagnostics.pending).toBe(true);
    resolve(complete());
    await vi.advanceTimersByTimeAsync(0);
    expect(sink.publish).toHaveBeenCalledOnce();
    expect(light.diagnostics.pending).toBe(false);
    light.dispose();
  });
  it.each(['epoch', 'revision', 'release'] as const)(
    'rejects a delayed above-render copy after %s changes',
    async (change) => {
      const { light, sink, authority, release } = fixture();
      authority.getChunkRevision = (_cx = 0, cy = 0) => (cy < 2 ? 0 : null);
      authority.inspectColumnSource.mockResolvedValue({
        ...complete(),
        entries: [
          {
            key: '0,2,0',
            cx: 0,
            cy: 2,
            cz: 0,
            revision: 0,
            resident: true,
            dirty: false,
          },
        ],
      });
      let completeCopy!: (copy: { canonical: Uint16Array; revision: number }) => void;
      authority.readSkyColumnChunk.mockImplementation(
        () =>
          new Promise((resolve) => {
            completeCopy = resolve;
          }),
      );
      await vi.advanceTimersByTimeAsync(16);
      expect(authority.readSkyColumnChunk).toHaveBeenCalledOnce();
      if (change === 'epoch') authority.runtimeEpoch = 'world:2';
      if (change === 'revision') authority.worldRevision = 1;
      if (change === 'release') release();
      completeCopy({ canonical: new Uint16Array(32 ** 3).fill(Voxel.Air), revision: 0 });
      await vi.advanceTimersByTimeAsync(0);
      expect(sink.publish).not.toHaveBeenCalled();
      light.dispose();
    },
  );
  it.each(['unknown', 'revision', 'shape'] as const)('keeps a %s above-render copy dark', async (failure) => {
    const { light, sink, authority } = fixture();
    authority.getChunkRevision = (_cx = 0, cy = 0) => (cy < 2 ? 0 : null);
    authority.inspectColumnSource.mockResolvedValue({
      ...complete(),
      entries: [
        {
          key: '0,2,0',
          cx: 0,
          cy: 2,
          cz: 0,
          revision: 0,
          resident: true,
          dirty: false,
        },
      ],
    });
    authority.readSkyColumnChunk.mockResolvedValue(
      failure === 'unknown'
        ? null
        : {
            canonical: new Uint16Array(failure === 'shape' ? 1 : 32 ** 3),
            revision: failure === 'revision' ? 1 : 0,
          },
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(sink.publish).not.toHaveBeenCalled();
    expect(authority.readSkyColumnChunk).toHaveBeenCalledOnce();
    expect(light.sample([0.5, 0.5, 0.5])).toMatchObject({ ready: false });
    light.dispose();
  });
  it.each([false, true])('reads actual above-render source copies and preserves roof=%s obstruction', async (roof) => {
    const { light, sink, authority } = fixture();
    authority.getChunkRevision = (_cx = 0, cy = 0) => (cy < 2 ? 0 : null);
    authority.inspectColumnSource.mockResolvedValue({
      ...complete(),
      entries: Array.from({ length: 5 }, (_, cy) => ({
        key: `0,${cy},0`,
        cx: 0,
        cy,
        cz: 0,
        revision: 0,
        resident: true,
        dirty: false,
      })),
    });
    authority.readSkyColumnChunk.mockImplementation(async (_cx, cy) => {
      const canonical = new Uint16Array(32 ** 3).fill(Voxel.Air);
      if (roof && cy === 2)
        for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) canonical[x + 32 * z] = Voxel.Stone;
      return { canonical, revision: 0 };
    });
    await vi.advanceTimersByTimeAsync(16);
    expect(authority.readSkyColumnChunk).toHaveBeenCalledTimes(3);
    expect(sink.publish).toHaveBeenCalledOnce();
    expect(light.sample([0.5, 0.5, 0.5])).toMatchObject({ ready: true, visibility: roof ? 0 : 1 });
    light.dispose();
  });
  it('completes the full legal column proof with bounded voxel reads in each task', async () => {
    let reads = 0;
    let previous = 0;
    let maximum = 0;
    const { light, sink, authority } = fixture({
      yieldTask: async () => {
        maximum = Math.max(maximum, reads - previous);
        previous = reads;
      },
    });
    authority.inspectColumnSource.mockResolvedValue({ ...complete(), generatedEmptyAboveY: 511 });
    authority.getVoxel = () => {
      reads++;
      return Voxel.Air;
    };
    await vi.advanceTimersByTimeAsync(16);
    maximum = Math.max(maximum, reads - previous);
    expect(reads).toBe(1024 * 512);
    expect(maximum).toBeLessThanOrEqual(4096);
    expect(sink.publish).toHaveBeenCalledTimes(1);
    expect(light.sample([0.5, 0.5, 0.5])).toMatchObject({ ready: true, visibility: 1 });
    light.dispose();
  });
  it.each(['epoch', 'revision', 'residency', 'release'] as const)(
    'cancels before reading more columns or publishing after %s changes during proof',
    async (change) => {
      let cancel: () => void = () => undefined;
      const { light, sink, authority, release } = fixture({ yieldTask: async () => cancel() });
      let reads = 0;
      authority.getVoxel = () => {
        reads++;
        return Voxel.Air;
      };
      cancel = () => {
        if (change === 'epoch') authority.runtimeEpoch = 'world:2';
        if (change === 'revision') authority.worldRevision = 1;
        if (change === 'residency') authority.getChunkRevision = () => null;
        if (change === 'release') release();
      };
      await vi.advanceTimersByTimeAsync(16);
      expect(sink.publish).not.toHaveBeenCalled();
      expect(reads).toBeLessThanOrEqual(4096);
      light.dispose();
    },
  );
  it('publishes current source through the original cache and invalidates before snapshot catches up', async () => {
    const { light, sink } = fixture();
    await vi.advanceTimersByTimeAsync(16);
    expect(sink.publish).toHaveBeenCalledTimes(1);
    expect(light.sample([0.5, 0.5, 0.5])).toMatchObject({ ready: true, visibility: 1 });
    const previous = sink.failDark.mock.calls.length;
    light.notifyCommit(1);
    expect(sink.failDark).toHaveBeenCalledTimes(previous + 1);
    expect(light.sample([0.5, 0.5, 0.5])).toMatchObject({ ready: false });
    light.dispose();
  });
  it.each(['epoch', 'revision', 'residency'] as const)(
    'rejects delayed source after %s change and keeps at most one job',
    async (change) => {
      const { light, sink, authority } = fixture();
      let resolve!: (source: SkyColumnSource) => void;
      authority.inspectColumnSource.mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      await vi.advanceTimersByTimeAsync(16);
      light.request([0, 0, 0]);
      await vi.advanceTimersByTimeAsync(100);
      expect(authority.inspectColumnSource).toHaveBeenCalledTimes(1);
      if (change === 'epoch') authority.runtimeEpoch = 'world:2';
      if (change === 'revision') authority.worldRevision = 1;
      if (change === 'residency') authority.getChunkRevision = () => null;
      resolve(complete());
      await vi.advanceTimersByTimeAsync(0);
      expect(sink.publish).not.toHaveBeenCalled();
      light.dispose();
    },
  );
  it('does not publish after resource release, even if persistence returns later', async () => {
    const { light, sink, authority, release } = fixture();
    let resolve!: (source: SkyColumnSource) => void;
    authority.inspectColumnSource.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await vi.advanceTimersByTimeAsync(16);
    release();
    resolve(complete());
    await vi.advanceTimersByTimeAsync(0);
    expect(sink.publish).not.toHaveBeenCalled();
    light.dispose();
  });
  it.each(['budget-exhausted', 'invalid-data', 'source-unavailable'] as const)(
    'keeps %s metadata dark without polling',
    async (reason) => {
      const { light, sink, authority } = fixture();
      authority.inspectColumnSource.mockResolvedValue({ status: 'unknown', reason });
      await vi.advanceTimersByTimeAsync(100);
      expect(sink.publish).not.toHaveBeenCalled();
      expect(authority.inspectColumnSource).toHaveBeenCalledOnce();
      expect(light.sample([0.5, 0.5, 0.5])).toMatchObject({ ready: false });
      light.dispose();
    },
  );
  it('current metadata cannot conceal a client/source revision mismatch', async () => {
    const { light, sink, authority } = fixture();
    authority.inspectColumnSource.mockResolvedValue(complete(1));
    await vi.advanceTimersByTimeAsync(16);
    expect(sink.publish).not.toHaveBeenCalled();
    light.dispose();
  });
});
