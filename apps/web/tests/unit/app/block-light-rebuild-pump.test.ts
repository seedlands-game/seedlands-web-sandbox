import { afterEach, describe, expect, it, vi } from 'vitest';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { BlockLightRebuildPump } from '../../../src/app/scene/block-light-rebuild-pump';
import { ChunkBlockLightCache } from '../../../src/app/scene/block-light-volume';
import { World } from '../../../src/app/world/world-runtime';
import { classicContent } from '../../fixtures/classic/content';

type PumpCache = ConstructorParameters<typeof BlockLightRebuildPump>[0];

const fakeTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });

function fakePumpCache(pending: () => number, rebuildNearest: PumpCache['rebuildNearest']): PumpCache {
  return {
    get snapshot() {
      const pendingBrickCount = pending();
      return {
        brickCount: 2,
        allocatedBrickCount: 2,
        allocatedBytes: 2,
        pendingBrickCount,
        ready: pendingBrickCount === 0,
        rebuildCount: 0,
      };
    },
    rebuildNearest,
  };
}

function realLightCache(
  readRevision: () => string = () => 'resident:1',
  chunks: readonly (readonly [string, number])[] = [
    ['camera', 0],
    ['middle', 4],
    ['far', 8],
  ],
) {
  const apply = vi.fn();
  const cache = new ChunkBlockLightCache({
    getVoxelIfLoaded: () => Voxel.Air,
    blockLightRevision: readRevision,
    voxelSemantics: classicContent.voxelSemantics,
  });
  for (const [key, cx] of chunks) cache.register(key, cx, 0, 0, { failDark: () => {}, apply });
  return { cache, apply };
}

describe('World derived-light rebuild pump', () => {
  afterEach(() => vi.useRealTimers());

  it('continues servicing real pending bricks after the single World drain returns', async () => {
    fakeTimers();
    const { cache } = realLightCache();
    const repository = { drain: vi.fn() };
    const blockLightRebuildPump = new BlockLightRebuildPump(cache);
    const receiver = { repository, blockLightCache: cache, blockLightRebuildPump };

    expect(cache.snapshot).toMatchObject({ pendingBrickCount: 3, ready: false, rebuildCount: 0 });
    World.prototype.drainCommits.call(receiver as unknown as World, [0, 0, 0]);
    expect(repository.drain).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(cache.snapshot).toMatchObject({ pendingBrickCount: 0, ready: true, rebuildCount: 3 });
    blockLightRebuildPump.dispose();
  });

  it('keeps one timer, copies the latest camera position, and rebuilds at most once per turn', async () => {
    fakeTimers();
    let pendingBrickCount = 2;
    const rebuildNearest = vi.fn((_position: readonly [number, number, number]) => {
      pendingBrickCount -= 1;
      return true;
    });
    const cache = fakePumpCache(() => pendingBrickCount, rebuildNearest);
    const pump = new BlockLightRebuildPump(cache);
    const first: [number, number, number] = [1, 2, 3];
    const latest: [number, number, number] = [10, 20, 30];

    pump.request(first);
    pump.request(latest);
    latest[0] = 999;
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(0);
    expect(rebuildNearest).toHaveBeenCalledOnce();
    expect(rebuildNearest).toHaveBeenLastCalledWith([10, 20, 30]);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(15);
    expect(rebuildNearest).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(rebuildNearest).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    pump.dispose();
  });

  it('keeps the elapsed-time cooldown when new work arrives after the queue empties', async () => {
    fakeTimers();
    let pendingBrickCount = 1;
    const rebuildNearest = vi.fn(() => {
      vi.advanceTimersByTime(40);
      pendingBrickCount -= 1;
      return true;
    });
    const cache = fakePumpCache(() => pendingBrickCount, rebuildNearest);
    const pump = new BlockLightRebuildPump(cache);

    pump.request([0, 0, 0]);
    await vi.advanceTimersByTimeAsync(0);
    expect(rebuildNearest).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);

    pendingBrickCount = 1;
    pump.request([1, 0, 0]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(159);
    expect(rebuildNearest).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(rebuildNearest).toHaveBeenCalledTimes(2);
    pump.dispose();
  });

  it('does not schedule a non-finite camera position', () => {
    fakeTimers();
    const rebuildNearest = vi.fn(() => true);
    const cache = fakePumpCache(() => 1, rebuildNearest);
    const pump = new BlockLightRebuildPump(cache);

    pump.request([Number.NaN, 0, 0]);
    pump.request([0, Number.POSITIVE_INFINITY, 0]);
    expect(vi.getTimerCount()).toBe(0);
    expect(rebuildNearest).not.toHaveBeenCalled();
    pump.dispose();
  });

  it('keeps a newly stale real brick unready until its revised halo is rebuilt', async () => {
    fakeTimers();
    let revision = 'resident:1';
    const { cache, apply } = realLightCache(() => revision, []);
    const pump = new BlockLightRebuildPump(cache);
    cache.register('only', 0, 0, 0, { failDark: () => {}, apply });
    expect(cache.rebuildNearest([0, 0, 0])).toBe(true);
    expect(cache.snapshot).toMatchObject({ pendingBrickCount: 0, ready: true, rebuildCount: 1 });

    revision = 'resident:2';
    cache.invalidateAround(0, 0, 0);
    expect(cache.snapshot).toMatchObject({ pendingBrickCount: 1, ready: false, rebuildCount: 1 });
    pump.request([0, 0, 0]);
    expect(cache.snapshot.ready).toBe(false);

    await vi.advanceTimersByTimeAsync(0);
    expect(cache.snapshot).toMatchObject({ pendingBrickCount: 0, ready: true, rebuildCount: 2 });
    expect(apply).toHaveBeenCalledTimes(2);
    pump.dispose();
  });

  it('detects a real cache halo revision change without manual invalidation or re-registration', () => {
    let revision = 'resident:1';
    const { cache, apply } = realLightCache(() => revision, []);
    cache.register('only', 0, 0, 0, { failDark: () => {}, apply });
    expect(cache.rebuildNearest([0, 0, 0])).toBe(true);
    expect(cache.snapshot).toMatchObject({ pendingBrickCount: 0, ready: true, rebuildCount: 1 });

    revision = 'resident:2';
    expect(cache.snapshot).toMatchObject({ pendingBrickCount: 1, ready: false, rebuildCount: 1 });
    expect(cache.rebuildNearest([0, 0, 0])).toBe(true);
    expect(cache.snapshot).toMatchObject({ pendingBrickCount: 0, ready: true, rebuildCount: 2 });
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('does not write a real cache sink after the pump is disposed', async () => {
    fakeTimers();
    const { cache, apply } = realLightCache(() => 'resident:1', []);
    const pump = new BlockLightRebuildPump(cache);
    cache.register('only', 0, 0, 0, { failDark: () => {}, apply });
    pump.request([0, 0, 0]);
    expect(vi.getTimerCount()).toBe(1);

    pump.dispose();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(cache.snapshot).toMatchObject({ pendingBrickCount: 1, ready: false, rebuildCount: 0 });
    expect(apply).not.toHaveBeenCalled();
  });

  it('World.dispose cancels the queued pump timer before repository disposal and cache clearing', () => {
    fakeTimers();
    const { cache, apply } = realLightCache(() => 'resident:1', []);
    const blockLightRebuildPump = new BlockLightRebuildPump(cache);
    cache.register('only', 0, 0, 0, { failDark: () => {}, apply });
    blockLightRebuildPump.request([0, 0, 0]);
    expect(vi.getTimerCount()).toBe(1);

    const repository = {
      drain: vi.fn(),
      dispose: vi.fn(() => expect(vi.getTimerCount()).toBe(0)),
    };
    const scheduler = { dispose: vi.fn() };
    const receiver = {
      disposed: false,
      blockLightRebuildPump,
      remeshTimer: null,
      scheduler,
      repository,
      blockLightCache: cache,
      dirtyChunks: new Set<string>(),
      fluidDirtyChunks: new Set<string>(),
    };

    World.prototype.dispose.call(receiver as unknown as World);

    expect(repository.dispose).toHaveBeenCalledOnce();
    expect(scheduler.dispose).toHaveBeenCalledOnce();
    expect(cache.snapshot).toMatchObject({ brickCount: 0, pendingBrickCount: 0, rebuildCount: 0 });
    expect(apply).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
