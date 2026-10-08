import { describe, expect, it, vi } from 'vitest';
import {
  SKY_VISIBILITY_VOLUME_BYTES,
  SKY_VISIBILITY_VOLUME_SIZE,
  SkyVisibilityCache,
  buildSkyVisibilityVolume,
  type SkyColumnObstructionSample,
  type SkyVisibilitySink,
  type SkyVisibilityVolume,
} from '../../../src/app/scene/sky-visibility-volume';

const columns = (
  bottomY = 0,
  worldTopY = 63,
  change?: (column: SkyColumnObstructionSample) => void,
): SkyColumnObstructionSample[] =>
  Array.from({ length: SKY_VISIBILITY_VOLUME_SIZE ** 2 }, (_, index) => {
    const sample = {
      localX: index % SKY_VISIBILITY_VOLUME_SIZE,
      localZ: Math.floor(index / SKY_VISIBILITY_VOLUME_SIZE),
      bottomY,
      obstruction: new Uint8Array(worldTopY - bottomY + 1),
      loaded: new Uint8Array(worldTopY - bottomY + 1).fill(1),
    };
    change?.(sample);
    return sample;
  });

const sink = () => {
  const published: SkyVisibilityVolume[] = [];
  const value: SkyVisibilitySink = {
    failDark: vi.fn(),
    publish: vi.fn((volume) => published.push(volume)),
    dispose: vi.fn(),
  };
  return { value, published };
};

const readyDependency = (key: string, revision: number) => ({ key, resident: true, revision }) as const;

describe('per-chunk sky visibility derived cache', () => {
  it('fails dark when any dependency or relevant column cell is unknown', () => {
    const output = sink();
    const cache = new SkyVisibilityCache(2, { worldTime: 6, profileScalar: 0.4 });
    cache.register('0,0,0', [0, 0, 0], ['0,0,0', '0,1,0'], output.value);
    cache.setDependency(readyDependency('0,0,0', 1));

    const unavailableDependency = cache.beginBuild('0,0,0', 63, columns());
    expect(buildSkyVisibilityVolume(unavailableDependency)).toMatchObject({
      ready: false,
      reason: 'source-unavailable',
    });
    expect(cache.sample('0,0,0', 0, 0, 0)).toMatchObject({ ready: false, visibility: 0, receivedSky: 0 });

    cache.setDependency(readyDependency('0,1,0', 2));
    const incomplete = columns();
    incomplete[0]!.loaded[63] = 0;
    const unavailableCell = cache.beginBuild('0,0,0', 63, incomplete);
    expect(buildSkyVisibilityVolume(unavailableCell)).toMatchObject({
      ready: false,
      reason: 'source-unavailable',
    });
    expect(cache.publish(unavailableCell, buildSkyVisibilityVolume(unavailableCell))).toBe(false);
    expect(output.published).toEqual([]);
  });

  it('publishes one complete matching revision atomically and applies frame scalars without rebuilding', () => {
    const output = sink();
    const cache = new SkyVisibilityCache(1, { worldTime: 12, profileScalar: 0.5 });
    cache.register('0,0,0', [0, 0, 0], ['0,0,0', '0,1,0'], output.value);
    cache.setDependency(readyDependency('0,0,0', 4));
    cache.setDependency(readyDependency('0,1,0', 9));
    const input = columns();
    input[0]!.obstruction[63] = 255;
    const ticket = cache.beginBuild('0,0,0', 63, input);
    const result = buildSkyVisibilityVolume(ticket);

    expect(cache.sample('0,0,0', 1, 0, 0).ready).toBe(false);
    expect(cache.publish(ticket, result)).toBe(true);
    expect(output.published).toHaveLength(1);
    expect(output.published[0]!.visibility).toHaveLength(SKY_VISIBILITY_VOLUME_BYTES);
    expect(cache.sample('0,0,0', 0, 0, 0)).toMatchObject({ ready: true, visibility: 0, receivedSky: 0 });
    expect(cache.sample('0,0,0', 1, 0, 0)).toMatchObject({ ready: true, visibility: 1, receivedSky: 0.5 });

    const builds = cache.diagnostics.buildingChunkCount;
    cache.setLightingFrame({ worldTime: 18, profileScalar: 0.25 });
    expect(cache.diagnostics.buildingChunkCount).toBe(builds);
    expect(cache.sample('0,0,0', 1, 0, 0)).toMatchObject({
      ready: true,
      visibility: 1,
      receivedSky: 0.25,
      worldTime: 18,
    });
  });

  it('invalidates immediately on edit and rejects a completed build from the old source revision', () => {
    const output = sink();
    const cache = new SkyVisibilityCache(1, { worldTime: 12, profileScalar: 1 });
    cache.register('0,0,0', [0, 0, 0], ['0,0,0'], output.value);
    cache.setDependency(readyDependency('0,0,0', 1));
    const initial = cache.beginBuild('0,0,0', 63, columns());
    expect(cache.publish(initial, buildSkyVisibilityVolume(initial))).toBe(true);

    cache.setDependency(readyDependency('0,0,0', 2));
    const staleTicket = cache.beginBuild('0,0,0', 63, columns());
    const staleResult = buildSkyVisibilityVolume(staleTicket);
    cache.setDependency(readyDependency('0,0,0', 3));

    expect(output.value.failDark).toHaveBeenCalledTimes(2);
    expect(cache.sample('0,0,0', 1, 0, 0).ready).toBe(false);
    expect(cache.publish(staleTicket, staleResult)).toBe(false);
    expect(output.published).toHaveLength(1);

    const currentTicket = cache.beginBuild('0,0,0', 63, columns());
    expect(currentTicket.sourceRevision).not.toBe(staleTicket.sourceRevision);
    const currentResult = buildSkyVisibilityVolume(currentTicket);
    if (!currentResult.ready) throw new Error('Fixture sky visibility build must be complete.');
    expect(
      cache.publish(currentTicket, {
        ...currentResult,
        volume: { ...currentResult.volume, origin: [32, 0, 0] },
      }),
    ).toBe(false);

    const malformedChunkTicket = cache.beginBuild('0,0,0', 63, columns());
    const malformedChunkResult = buildSkyVisibilityVolume(malformedChunkTicket);
    if (!malformedChunkResult.ready) throw new Error('Fixture sky visibility build must be complete.');
    expect(
      cache.publish(malformedChunkTicket, {
        ...malformedChunkResult,
        volume: { ...malformedChunkResult.volume, chunk: [] as unknown as readonly [number, number, number] },
      }),
    ).toBe(false);

    const malformedOriginTicket = cache.beginBuild('0,0,0', 63, columns());
    const malformedOriginResult = buildSkyVisibilityVolume(malformedOriginTicket);
    if (!malformedOriginResult.ready) throw new Error('Fixture sky visibility build must be complete.');
    expect(
      cache.publish(malformedOriginTicket, {
        ...malformedOriginResult,
        volume: { ...malformedOriginResult.volume, origin: [0, 0, 0.5] },
      }),
    ).toBe(false);
    const retry = cache.beginBuild('0,0,0', 63, columns());
    expect(cache.publish(retry, buildSkyVisibilityVolume(retry))).toBe(true);
    expect(cache.sample('0,0,0', 1, 0, 0).ready).toBe(true);
  });

  it('rejects an older completion when a later build supersedes it at the same source revision', () => {
    const output = sink();
    const cache = new SkyVisibilityCache(1, { worldTime: 12, profileScalar: 1 });
    cache.register('0,0,0', [0, 0, 0], ['0,0,0'], output.value);
    cache.setDependency(readyDependency('0,0,0', 1));
    const older = cache.beginBuild('0,0,0', 63, columns());
    const newer = cache.beginBuild('0,0,0', 63, columns());

    expect(cache.publish(older, buildSkyVisibilityVolume(older))).toBe(false);
    expect(output.published).toEqual([]);
    expect(cache.publish(newer, buildSkyVisibilityVolume(newer))).toBe(true);
    expect(output.published).toHaveLength(1);
  });

  it('keeps a published replacement predecessor alive until its own release', () => {
    const previous = sink();
    const current = sink();
    const cache = new SkyVisibilityCache(1, { worldTime: 12, profileScalar: 1 });
    const releasePrevious = cache.register('0,0,0', [0, 0, 0], ['0,0,0'], previous.value);
    cache.setDependency(readyDependency('0,0,0', 1));
    const previousTicket = cache.beginBuild('0,0,0', 63, columns());
    expect(cache.publish(previousTicket, buildSkyVisibilityVolume(previousTicket))).toBe(true);
    const releaseCurrent = cache.register('0,0,0', [0, 0, 0], ['0,0,0'], current.value);

    expect(previous.value.failDark).toHaveBeenCalledOnce();
    expect(previous.value.dispose).not.toHaveBeenCalled();

    releasePrevious();
    expect(previous.value.failDark).toHaveBeenCalledTimes(2);
    expect(previous.value.dispose).toHaveBeenCalledOnce();
    releasePrevious();
    expect(previous.value.dispose).toHaveBeenCalledOnce();

    releaseCurrent();
    expect(current.value.dispose).toHaveBeenCalledOnce();
  });

  it('rejects a late build from a replaced entry with the same key', () => {
    const previous = sink();
    const current = sink();
    const cache = new SkyVisibilityCache(1, { worldTime: 12, profileScalar: 1 });
    cache.register('0,0,0', [0, 0, 0], ['0,0,0'], previous.value);
    cache.setDependency(readyDependency('0,0,0', 1));
    const staleTicket = cache.beginBuild('0,0,0', 63, columns());
    cache.register('0,0,0', [0, 0, 0], ['0,0,0'], current.value);

    expect(cache.publish(staleTicket, buildSkyVisibilityVolume(staleTicket))).toBe(false);
    expect(previous.published).toEqual([]);
    expect(current.published).toEqual([]);
  });

  it('disposes active and unreleased retired sinks exactly once', () => {
    const previous = sink();
    const current = sink();
    const cache = new SkyVisibilityCache(1, { worldTime: 12, profileScalar: 1 });
    const releasePrevious = cache.register('0,0,0', [0, 0, 0], ['0,0,0'], previous.value);
    cache.register('0,0,0', [0, 0, 0], ['0,0,0'], current.value);

    cache.dispose();
    cache.dispose();
    releasePrevious();

    expect(previous.value.dispose).toHaveBeenCalledOnce();
    expect(current.value.dispose).toHaveBeenCalledOnce();
  });

  it('tracks vertical cross-Chunk dependencies without invalidating an unrelated column', () => {
    const lower = sink();
    const other = sink();
    const cache = new SkyVisibilityCache(2, { worldTime: 12, profileScalar: 1 });
    cache.register('0,0,0', [0, 0, 0], ['0,0,0', '0,1,0'], lower.value);
    cache.register('1,0,0', [1, 0, 0], ['1,0,0', '1,1,0'], other.value);
    for (const key of ['0,0,0', '0,1,0', '1,0,0', '1,1,0']) cache.setDependency(readyDependency(key, 1));
    for (const [key, input] of [
      ['0,0,0', columns()],
      ['1,0,0', columns()],
    ] as const) {
      const ticket = cache.beginBuild(key, 63, input);
      expect(cache.publish(ticket, buildSkyVisibilityVolume(ticket))).toBe(true);
    }

    cache.setDependency(readyDependency('0,1,0', 2));
    expect(cache.sample('0,0,0', 0, 0, 0).ready).toBe(false);
    expect(cache.sample('1,0,0', 0, 0, 0).ready).toBe(true);
    expect(lower.value.failDark).toHaveBeenCalledTimes(2);
    expect(other.value.failDark).toHaveBeenCalledTimes(1);
  });

  it('unloads and disposes sinks while keeping cache-owned bytes within its declared bound', () => {
    const first = sink();
    const second = sink();
    const cache = new SkyVisibilityCache(2, { worldTime: 12, profileScalar: 1 });
    const releaseFirst = cache.register('0,0,0', [0, 0, 0], ['0,0,0'], first.value);
    cache.register('1,0,0', [1, 0, 0], ['1,0,0'], second.value);
    for (const key of ['0,0,0', '1,0,0']) cache.setDependency(readyDependency(key, 1));
    for (const [key, input] of [
      ['0,0,0', columns()],
      ['1,0,0', columns()],
    ] as const) {
      const ticket = cache.beginBuild(key, 63, input);
      expect(cache.publish(ticket, buildSkyVisibilityVolume(ticket))).toBe(true);
    }

    expect(cache.diagnostics).toMatchObject({
      registeredChunkCount: 2,
      readyChunkCount: 2,
      allocatedBytes: 2 * SKY_VISIBILITY_VOLUME_BYTES,
      maximumBytes: 2 * SKY_VISIBILITY_VOLUME_BYTES,
    });
    expect(() => cache.register('2,0,0', [2, 0, 0], ['2,0,0'], sink().value)).toThrow(/capacity/i);
    releaseFirst();
    expect(first.value.dispose).toHaveBeenCalledOnce();
    expect(cache.diagnostics).toMatchObject({
      registeredChunkCount: 1,
      dependencyCount: 1,
      allocatedBytes: SKY_VISIBILITY_VOLUME_BYTES,
    });

    cache.dispose();
    cache.dispose();
    expect(second.value.dispose).toHaveBeenCalledOnce();
    expect(cache.diagnostics).toMatchObject({ disposed: true, registeredChunkCount: 0, allocatedBytes: 0 });
  });

  it('drops all derived state on restore and rebuilds only from newly resident revisions', () => {
    const output = sink();
    const cache = new SkyVisibilityCache(1, { worldTime: 8, profileScalar: 0.75 });
    cache.register('0,0,0', [0, 0, 0], ['0,0,0'], output.value);
    cache.setDependency(readyDependency('0,0,0', 7));
    const beforeRestore = cache.beginBuild('0,0,0', 63, columns());
    expect(cache.publish(beforeRestore, buildSkyVisibilityVolume(beforeRestore))).toBe(true);

    cache.resetForRestore();
    expect(cache.diagnostics).toMatchObject({ readyChunkCount: 0, dirtyChunkCount: 1, allocatedBytes: 0 });
    expect(cache.sample('0,0,0', 0, 0, 0)).toMatchObject({ ready: false, visibility: 0, receivedSky: 0 });
    expect(cache.publish(beforeRestore, buildSkyVisibilityVolume(beforeRestore))).toBe(false);

    const unavailable = cache.beginBuild('0,0,0', 63, columns());
    expect(buildSkyVisibilityVolume(unavailable).ready).toBe(false);
    cache.setDependency(readyDependency('0,0,0', 1));
    const restored = cache.beginBuild('0,0,0', 63, columns());
    expect(cache.publish(restored, buildSkyVisibilityVolume(restored))).toBe(true);
    expect(cache.sample('0,0,0', 0, 0, 0).ready).toBe(true);
  });
});
