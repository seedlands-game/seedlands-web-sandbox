import { afterEach, describe, expect, it, vi } from 'vitest';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { classicContent } from '../../fixtures/classic/content';
import { WorldSkyLighting } from '../../../src/app/scene/world-sky-lighting';
import type { SkyColumnSource } from '../../../src/app/scene/sky-column-source';

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
    getChunkRevision: (): number | null => 0,
    inspectColumnSource: vi.fn(async (): Promise<SkyColumnSource> => complete()),
  };
  const light = new WorldSkyLighting(authority, options ?? { yieldTask: async () => undefined });
  const sink = { failDark: vi.fn(), publish: vi.fn(), dispose: vi.fn() };
  const release = light.register({ chunkKey: '0,0,0', cx: 0, cy: 0, cz: 0 }, sink);
  return { authority, light, sink, release };
};
afterEach(() => vi.useRealTimers());

describe('production World sky derived owner', () => {
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
  it('keeps unknown metadata dark instead of constructing partial sky', async () => {
    const { light, sink, authority } = fixture();
    authority.inspectColumnSource.mockResolvedValue({ status: 'unknown', reason: 'budget-exhausted' });
    await vi.advanceTimersByTimeAsync(16);
    expect(sink.publish).not.toHaveBeenCalled();
    expect(light.sample([0.5, 0.5, 0.5])).toMatchObject({ ready: false });
    light.dispose();
  });
  it('current metadata cannot conceal a client/source revision mismatch', async () => {
    const { light, sink, authority } = fixture();
    authority.inspectColumnSource.mockResolvedValue(complete(1));
    await vi.advanceTimersByTimeAsync(16);
    expect(sink.publish).not.toHaveBeenCalled();
    light.dispose();
  });
});
