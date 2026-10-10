import { afterEach, describe, expect, it, vi } from 'vitest';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { classicContent } from '../../fixtures/classic/content';
import { WorldSkyLighting } from '../../../src/app/scene/world-sky-lighting';
import type { SkyColumnSource } from '../../../src/app/scene/sky-column-source';

const complete = (revision = 0): SkyColumnSource => ({
  status: 'complete',
  cx: 0,
  cz: 0,
  epoch: 1,
  worldRevision: revision,
  directoryRevision: 0,
  generatedEmptyAboveY: 51,
  entries: [],
});
const fixture = () => {
  vi.useFakeTimers();
  const authority = {
    runtimeEpoch: 'world:1',
    worldRevision: 0,
    worldTime: 9,
    voxelSemantics: classicContent.voxelSemantics,
    getVoxel: () => Voxel.Air,
    getChunkRevision: (): number | null => 0,
    inspectColumnSource: vi.fn(async () => complete()),
  };
  const light = new WorldSkyLighting(authority);
  const sink = { failDark: vi.fn(), publish: vi.fn(), dispose: vi.fn() };
  const release = light.register({ chunkKey: '0,0,0', cx: 0, cy: 0, cz: 0 }, sink);
  return { authority, light, sink, release };
};
afterEach(() => vi.useRealTimers());

describe('production World sky derived owner', () => {
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
