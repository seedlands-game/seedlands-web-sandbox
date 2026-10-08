import type { Page } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyEquipmentRouteWait,
  EQUIPMENT_RESOURCE_ROUTE_OPTIONS,
  EQUIPMENT_RESOURCE_WALK_OPTIONS,
  followEquipmentRoute,
  matchesEquipmentRouteArrival,
} from './equipment-resource-route';
import { walkTo, type ClassicSnapshot } from './harness';
import type { Point, RoutePoint } from './scenario';

const TARGET: RoutePoint = [92.5, 2.5];
const BROWSER19_CURRENT: Point = [92.49510192871094, 32.599998474121094, 2.2007970809936523];
const BROWSER19_STRICT: Point = [92.49810791015625, 32.599998474121094, 2.442101240158081];
const KEY_S_TARGET_YAW = 1.8717187781891766;

const routeSnapshot = (
  player: Point,
  tick: number,
  ack: number,
  options: Readonly<{
    server?: Point;
    view?: readonly [number, number];
    onGround?: boolean;
    colliding?: boolean;
  }> = {},
): ClassicSnapshot =>
  ({
    player,
    serverPlayerPosition: options.server ?? player,
    serverPlayerVelocity: [0, 0, 0] as Point,
    viewAngles: options.view ?? [KEY_S_TARGET_YAW, -20.03],
    onGround: options.onGround ?? true,
    colliding: options.colliding ?? false,
    interactionAttempts: 39,
    authority: { physicsTick: tick, acknowledgedInputSequence: ack, commitSequence: 1, residency: null },
  }) as ClassicSnapshot;

function routePage(
  options: Readonly<{
    initial: ClassicSnapshot;
    correction: ClassicSnapshot | null;
    refreshed: ClassicSnapshot | null;
    afterPulse?: ClassicSnapshot;
    onRead?: (read: number) => void;
  }>,
) {
  const calls = { reads: 0, down: 0, up: 0, moves: 0, pressed: false };
  const page = {
    evaluate: async (callback: (...args: unknown[]) => unknown) => {
      const source = String(callback);
      if (!source.includes('snapshot()')) throw new Error('Unexpected evaluate callback');
      calls.reads += 1;
      options.onRead?.(calls.reads);
      if (calls.reads === 1) return options.initial;
      if (calls.pressed) return options.afterPulse ?? options.refreshed;
      if (calls.reads === 2) return options.correction;
      return options.refreshed;
    },
    keyboard: {
      down: async (key: string) => {
        expect(key).toBe('KeyS');
        calls.down += 1;
        calls.pressed = true;
      },
      up: async (key: string) => {
        expect(key).toBe('KeyS');
        calls.up += 1;
      },
    },
    locator: () => ({
      boundingBox: async () => {
        calls.moves += 1;
        return { x: 0, y: 0, width: 960, height: 540 };
      },
    }),
    mouse: { move: async () => undefined },
  } as unknown as Page;
  return { calls, page };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Classic V2 pickup route post-correction refresh', () => {
  it('returns the Browser19 strict correction snapshot before sending pulse 9', async () => {
    const initial = routeSnapshot(BROWSER19_CURRENT, 27112, 20538);
    const strict = routeSnapshot(BROWSER19_STRICT, 27121, 20546);
    const { calls, page } = routePage({ initial, correction: strict, refreshed: strict });

    const result = await walkTo(page, TARGET, {
      key: 'KeyS',
      timeout: 45_000,
      ...EQUIPMENT_RESOURCE_WALK_OPTIONS,
      refreshAfterCorrection: true,
    });

    expect(calls).toMatchObject({ reads: 2, down: 0, up: 0, moves: 0 });
    expect(result).toBe(strict);
  });

  it('does not send input when correction exhausts the original deadline', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const initial = routeSnapshot(BROWSER19_CURRENT, 27112, 20538);
    const alignedNotReached = routeSnapshot([92.497, 32.6, 2.3], 27121, 20546, {
      view: [0.8592819133153222, -20.03],
    });
    const strict = routeSnapshot(BROWSER19_STRICT, 27124, 20549);
    const { calls, page } = routePage({
      initial,
      correction: alignedNotReached,
      refreshed: strict,
      onRead: (read) => {
        if (read === 2) now = 46_001;
      },
    });

    await expect(
      walkTo(page, TARGET, {
        key: 'KeyS',
        timeout: 45_000,
        ...EQUIPMENT_RESOURCE_ROUTE_OPTIONS,
        pulseMs: 0,
        refreshAfterCorrection: true,
      }),
    ).rejects.toThrow('Real input route timed out before 92.5,2.5.');
    expect(calls).toMatchObject({ reads: 2, down: 0, up: 0 });
  });

  it('does not send input when the refresh await exhausts the original deadline', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const initial = routeSnapshot(BROWSER19_CURRENT, 27112, 20538);
    const alignedNotReached = routeSnapshot([92.497, 32.6, 2.3], 27121, 20546, {
      view: [0.8592819133153222, -20.03],
    });
    const strict = routeSnapshot(BROWSER19_STRICT, 27124, 20549);
    const { calls, page } = routePage({
      initial,
      correction: alignedNotReached,
      refreshed: strict,
      onRead: (read) => {
        if (read === 3) now = 46_001;
      },
    });

    await expect(
      walkTo(page, TARGET, {
        key: 'KeyS',
        timeout: 45_000,
        ...EQUIPMENT_RESOURCE_ROUTE_OPTIONS,
        pulseMs: 0,
        refreshAfterCorrection: true,
      }),
    ).rejects.toThrow('Real input route timed out before 92.5,2.5.');
    expect(calls).toMatchObject({ reads: 3, down: 0, up: 0 });
  });

  it('fails closed when the post-correction refresh is unavailable', async () => {
    const initial = routeSnapshot(BROWSER19_CURRENT, 27112, 20538);
    const alignedNotReached = routeSnapshot([92.497, 32.6, 2.3], 27121, 20546, {
      view: [0.8592819133153222, -20.03],
    });
    const strict = routeSnapshot(BROWSER19_STRICT, 27124, 20549);
    const { calls, page } = routePage({
      initial,
      correction: alignedNotReached,
      refreshed: null,
      afterPulse: strict,
    });

    await expect(
      walkTo(page, TARGET, {
        key: 'KeyS',
        timeout: 45_000,
        ...EQUIPMENT_RESOURCE_ROUTE_OPTIONS,
        pulseMs: 0,
        refreshAfterCorrection: true,
      }),
    ).rejects.toThrow('Classic snapshot is unavailable after route correction.');
    expect(calls).toMatchObject({ reads: 3, down: 0, up: 0 });
  });

  it('continues with the original pulse when the refreshed client has not arrived', async () => {
    const initial = routeSnapshot(BROWSER19_CURRENT, 27112, 20538);
    const notReached = routeSnapshot([92.497, 32.6, 2.3], 27121, 20546, {
      view: [0.8592819133153222, -20.03],
    });
    const reached = routeSnapshot(BROWSER19_STRICT, 27124, 20549);
    const { calls, page } = routePage({ initial, correction: notReached, refreshed: notReached, afterPulse: reached });

    await expect(
      walkTo(page, TARGET, {
        key: 'KeyS',
        timeout: 45_000,
        ...EQUIPMENT_RESOURCE_ROUTE_OPTIONS,
        pulseMs: 0,
        refreshAfterCorrection: true,
      }),
    ).resolves.toStrictEqual(reached);
    expect(calls).toMatchObject({ reads: 4, down: 1, up: 1 });
  });

  it.each([
    { name: 'omitted', options: {} },
    { name: 'false', options: { refreshAfterCorrection: false } },
  ])('stops the $name default path when the route is reached during correction', async ({ options }) => {
    const initial = routeSnapshot(BROWSER19_CURRENT, 27112, 20538);
    const strict = routeSnapshot(BROWSER19_STRICT, 27121, 20546);
    const { calls, page } = routePage({ initial, correction: strict, refreshed: strict, afterPulse: strict });

    await expect(
      walkTo(page, TARGET, {
        key: 'KeyS',
        timeout: 45_000,
        ...EQUIPMENT_RESOURCE_ROUTE_OPTIONS,
        pulseMs: 0,
        ...options,
      }),
    ).resolves.toStrictEqual(strict);
    expect(calls).toMatchObject({ reads: 2, down: 0, up: 0 });
  });

  it.each([
    { name: 'omitted', options: {} },
    { name: 'false', options: { refreshAfterCorrection: false } },
  ])('keeps the $name default path when correction crosses the deadline', async ({ options }) => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const initial = routeSnapshot(BROWSER19_CURRENT, 27112, 20538);
    const corrected = routeSnapshot([92.497, 32.6, 2.3], 27121, 20546, {
      view: [0.8592819133153222, -20.03],
    });
    const reached = routeSnapshot(BROWSER19_STRICT, 27124, 20549);
    const { calls, page } = routePage({
      initial,
      correction: corrected,
      refreshed: corrected,
      afterPulse: reached,
      onRead: (read) => {
        if (read === 2) now = 46_001;
      },
    });

    await expect(
      walkTo(page, TARGET, {
        key: 'KeyS',
        timeout: 45_000,
        ...EQUIPMENT_RESOURCE_ROUTE_OPTIONS,
        pulseMs: 0,
        ...options,
      }),
    ).resolves.toStrictEqual(reached);
    expect(calls).toMatchObject({ reads: 3, down: 1, up: 1 });
  });

  it('returns a refreshed client arrival to the existing outer bounded wait when the server is late', async () => {
    let waitCalls = 0;
    const outerBaseline = routeSnapshot(BROWSER19_CURRENT, 27112, 20538);
    const serverLate = routeSnapshot(BROWSER19_STRICT, 27121, 20546, {
      server: [92.49811121062714, 32.6, 2.3],
    });
    const strict = routeSnapshot(BROWSER19_STRICT, 27124, 20549);
    const { calls, page } = routePage({ initial: outerBaseline, correction: serverLate, refreshed: serverLate });

    const result = await followEquipmentRoute(TARGET, {
      now: () => 1_000,
      observe: async () => outerBaseline,
      walk: (_direction, timeout) =>
        walkTo(page, TARGET, {
          key: 'KeyS',
          timeout,
          ...EQUIPMENT_RESOURCE_ROUTE_OPTIONS,
          pulseMs: 0,
          refreshAfterCorrection: true,
        }),
      waitForProgress: async (baseline, direction) => {
        waitCalls += 1;
        expect(classifyEquipmentRouteWait(baseline, strict, TARGET, direction)?.kind).toBe('arrival');
        return { kind: 'arrival', snapshot: strict };
      },
    });

    expect(result).toBe(strict);
    expect(calls).toMatchObject({ down: 0, up: 0 });
    expect(waitCalls).toBe(1);
  });

  it('keeps stale, unready, and one-sided snapshots out of strict arrival', () => {
    const baseline = routeSnapshot(BROWSER19_CURRENT, 27112, 20538);
    const strict = routeSnapshot(BROWSER19_STRICT, 27121, 20546);
    expect(matchesEquipmentRouteArrival(baseline, { ...strict, onGround: false }, TARGET, 'KeyS')).toBe(false);
    expect(matchesEquipmentRouteArrival(baseline, { ...strict, colliding: true }, TARGET, 'KeyS')).toBe(false);
    expect(
      matchesEquipmentRouteArrival(
        baseline,
        { ...strict, authority: { ...strict.authority, physicsTick: baseline.authority.physicsTick } },
        TARGET,
        'KeyS',
      ),
    ).toBe(false);
    expect(
      matchesEquipmentRouteArrival(baseline, { ...strict, serverPlayerPosition: [92.5, 32.6, 2.3] }, TARGET, 'KeyS'),
    ).toBe(false);
  });

  it('enables refresh only for the V2 equipment walk options', () => {
    expect(EQUIPMENT_RESOURCE_WALK_OPTIONS).toMatchObject({
      tolerance: 0.06,
      corridorTolerance: 0.08,
      pulseMs: 80,
      jump: false,
      refreshAfterCorrection: true,
    });
  });
});
