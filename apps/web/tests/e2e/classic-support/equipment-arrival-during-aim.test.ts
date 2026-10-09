import type { Page } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyEquipmentRouteWait,
  EQUIPMENT_RESOURCE_ROUTE_OPTIONS,
  EQUIPMENT_RESOURCE_WALK_OPTIONS,
  followEquipmentRoute,
  matchesEquipmentRouteArrival,
} from './equipment-resource-route';
import { lockPointer } from './mouse-input';
import { walkTo, type ClassicSnapshot } from './harness';
import { correctMouseToRoute, type RouteAimOutcome } from './target-aim';
import { reachedRouteTarget } from './route-progress';
import type { Point, RoutePoint } from './scenario';

const TARGET: RoutePoint = [80.5, -0.5];
const OUTER_BASELINE = snapshot(
  [80.5007095336914, 32.599998474121094, 2.444796085357666],
  18220,
  11443,
  [80.50070902152164, 32.6, 2.4447960558592863],
  -900.6799999999987,
);
const WALK_CURRENT = snapshot(
  [80.50038146972656, 32.599998474121094, -0.4135367274284363],
  18286,
  11509,
  [80.50077447174287, 32.6, -0.19409252460450183],
  -899.8999999999987,
);
const CLIENT_REACHED_SERVER_LATE = snapshot(
  [80.50038146972656, 32.599998474121094, -0.47464773058891296],
  18287,
  11510,
  [80.50064357211583, 32.6, -0.2635369690489463],
  -899.8999999999987,
);
const CLIENT_DRIFT_SERVER_REACHED = snapshot(
  [80.50038146972656, 32.599998474121094, -0.5802028179168701],
  18290,
  11513,
  [80.50038177286176, 32.6, -0.4746477374655492],
  -899.1199999999988,
);

function snapshot(player: Point, tick: number, ack: number, server: Point, yaw: number): ClassicSnapshot {
  return {
    player,
    serverPlayerPosition: server,
    viewAngles: [yaw, -20.159999999999993],
    onGround: true,
    colliding: false,
    interactionAttempts: 30,
    authority: { physicsTick: tick, acknowledgedInputSequence: ack, commitSequence: 1 },
  } as unknown as ClassicSnapshot;
}

function routePage(values: readonly ClassicSnapshot[]) {
  let read = 0;
  const calls = { reads: 0, moves: 0, down: 0, up: 0 };
  const page = {
    evaluate: async (callback: (...args: unknown[]) => unknown) => {
      const source = String(callback);
      if (source.includes('snapshot()')) {
        calls.reads += 1;
        return values[Math.min(read++, values.length - 1)] ?? null;
      }
      return undefined;
    },
    keyboard: {
      press: async (chord: string, options?: { delay?: number }): Promise<void> => {
        const keys = chord.split('+');
        for (const key of keys) await page.keyboard.down(key);
        await new Promise<void>((resolve) => setTimeout(resolve, options?.delay ?? 0));
        for (const key of keys.reverse()) await page.keyboard.up(key);
      },
      down: async () => {
        calls.down += 1;
      },
      up: async () => {
        calls.up += 1;
      },
    },
    locator: (selector: string) => ({
      isVisible: async () => false,
      boundingBox: async () => (selector === '#game' ? { x: 0, y: 0, width: 100_000, height: 540 } : null),
      click: async () => undefined,
    }),
    getByRole: () => ({ isVisible: async () => false, click: async () => undefined }),
    mouse: {
      move: async () => {
        calls.moves += 1;
      },
    },
    waitForFunction: async () => undefined,
    waitForTimeout: async () => undefined,
  } as unknown as Page;
  return { calls, page };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Classic V2 arrival during route aim', () => {
  it('hands Browser21 client arrival to the real outer wait before mouse or keyboard input', async () => {
    const { calls, page } = routePage([WALK_CURRENT, CLIENT_REACHED_SERVER_LATE, CLIENT_DRIFT_SERVER_REACHED]);
    await lockPointer(page);
    const directions: string[] = [];
    let waits = 0;

    await expect(
      followEquipmentRoute(TARGET, {
        now: () => 1_000,
        observe: async () => OUTER_BASELINE,
        walk: async (direction, timeout) => {
          directions.push(direction);
          if (directions.length > 1) throw new Error('Browser21 drift correction sentinel');
          return walkTo(page, TARGET, { key: direction, timeout, ...EQUIPMENT_RESOURCE_WALK_OPTIONS });
        },
        waitForProgress: async (baseline, direction) => {
          waits += 1;
          expect(baseline).toBe(CLIENT_REACHED_SERVER_LATE);
          expect(matchesEquipmentRouteArrival(OUTER_BASELINE, baseline, TARGET, direction)).toBe(false);
          expect(classifyEquipmentRouteWait(baseline, CLIENT_DRIFT_SERVER_REACHED, TARGET, direction)).toEqual({
            kind: 'drift',
            snapshot: CLIENT_DRIFT_SERVER_REACHED,
          });
          return { kind: 'drift', snapshot: CLIENT_DRIFT_SERVER_REACHED };
        },
      }),
    ).rejects.toThrow('Browser21 drift correction sentinel');

    expect(directions).toEqual(['KeyS', 'KeyW']);
    expect(waits).toBe(1);
    expect(calls).toMatchObject({ reads: 2, moves: 0, down: 0, up: 0 });
  });

  it('distinguishes an aligned angle from a reached route and still moves when neither is true', async () => {
    const far = snapshot([79.5, 32.6, -0.5], 1, 1, [79.5, 32.6, -0.5], -79.6);
    const aligned = snapshot([79.5, 32.6, -0.5], 2, 2, [79.5, 32.6, -0.5], -90);
    const observations = [far, aligned];
    let moves = 0;
    const angleResult: RouteAimOutcome<ClassicSnapshot> = await correctMouseToRoute({
      target: TARGET,
      direction: 'KeyW',
      observe: async () => observations.shift() ?? null,
      move: async () => {
        moves += 1;
      },
      routeReached: (current) =>
        reachedRouteTarget(
          current.player,
          TARGET,
          'KeyW',
          EQUIPMENT_RESOURCE_ROUTE_OPTIONS.tolerance,
          EQUIPMENT_RESOURCE_ROUTE_OPTIONS.corridorTolerance,
        ),
    });
    expect(angleResult).toEqual({ kind: 'angle-aligned', observation: aligned });
    expect(moves).toBe(1);

    moves = 0;
    const reachedResult: RouteAimOutcome<ClassicSnapshot> = await correctMouseToRoute({
      target: TARGET,
      direction: 'KeyS',
      observe: async () => CLIENT_REACHED_SERVER_LATE,
      move: async () => {
        moves += 1;
      },
      routeReached: (current) =>
        reachedRouteTarget(
          current.player,
          TARGET,
          'KeyS',
          EQUIPMENT_RESOURCE_ROUTE_OPTIONS.tolerance,
          EQUIPMENT_RESOURCE_ROUTE_OPTIONS.corridorTolerance,
        ),
    });
    expect(reachedResult).toEqual({ kind: 'route-reached', observation: CLIENT_REACHED_SERVER_LATE });
    expect(moves).toBe(0);
  });

  it('hands an exact V2 route point back before the pure-aim zero-vector error', async () => {
    const exact = snapshot([80.5, 32.6, -0.5], 2, 2, [80.5, 32.6, -0.5], 0);
    const reachedResult: RouteAimOutcome<ClassicSnapshot> = await correctMouseToRoute({
      target: TARGET,
      direction: 'KeyS',
      observe: async () => exact,
      move: async () => undefined,
      routeReached: (current) =>
        reachedRouteTarget(
          current.player,
          TARGET,
          'KeyS',
          EQUIPMENT_RESOURCE_ROUTE_OPTIONS.tolerance,
          EQUIPMENT_RESOURCE_ROUTE_OPTIONS.corridorTolerance,
        ),
    });
    expect(reachedResult).toEqual({ kind: 'route-reached', observation: exact });

    await expect(
      correctMouseToRoute({
        target: TARGET,
        direction: 'KeyS',
        observe: async () => exact,
        move: async () => undefined,
      }),
    ).rejects.toThrow('route aim direction is undefined');
  });

  it.each([
    { name: 'observation await', dates: [1_000, 1_000, 46_001] },
    { name: 'move boundary', dates: [1_000, 1_000, 1_000, 46_001] },
  ])('fails before new input when the true-path $name crosses the original deadline', async ({ dates }) => {
    let dateRead = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => dates[Math.min(dateRead++, dates.length - 1)]!);
    const misaligned = snapshot([79.5, 32.6, -0.5], 2, 2, [79.5, 32.6, -0.5], 0);
    const { calls, page } = routePage([farFromTarget(), misaligned]);
    await lockPointer(page);

    await expect(
      walkTo(page, TARGET, {
        key: 'KeyW',
        timeout: 45_000,
        ...EQUIPMENT_RESOURCE_WALK_OPTIONS,
      }),
    ).rejects.toThrow('Real input route timed out before 80.5,-0.5.');
    expect(calls).toMatchObject({ moves: 0, down: 0, up: 0 });
  });

  it('checks the original deadline after a terminal handoff without replacing its snapshot', async () => {
    const dates = [1_000, 1_000, 1_000, 46_001];
    let dateRead = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => dates[Math.min(dateRead++, dates.length - 1)]!);
    const { calls, page } = routePage([WALK_CURRENT, CLIENT_REACHED_SERVER_LATE]);

    await expect(
      walkTo(page, TARGET, { key: 'KeyS', timeout: 45_000, ...EQUIPMENT_RESOURCE_WALK_OPTIONS }),
    ).rejects.toThrow('Real input route timed out before 80.5,-0.5.');
    expect(calls).toMatchObject({ reads: 2, moves: 0, down: 0, up: 0 });
  });

  it('keeps server-late, stale, ack-regressed, unready and one-sided observations out of strict arrival', () => {
    expect(matchesEquipmentRouteArrival(OUTER_BASELINE, CLIENT_REACHED_SERVER_LATE, TARGET, 'KeyS')).toBe(false);
    expect(
      matchesEquipmentRouteArrival(
        OUTER_BASELINE,
        {
          ...CLIENT_REACHED_SERVER_LATE,
          serverPlayerPosition: CLIENT_REACHED_SERVER_LATE.player,
          authority: { ...CLIENT_REACHED_SERVER_LATE.authority, physicsTick: OUTER_BASELINE.authority.physicsTick },
        },
        TARGET,
        'KeyS',
      ),
    ).toBe(false);
    expect(
      matchesEquipmentRouteArrival(
        OUTER_BASELINE,
        {
          ...CLIENT_REACHED_SERVER_LATE,
          serverPlayerPosition: CLIENT_REACHED_SERVER_LATE.player,
          authority: { ...CLIENT_REACHED_SERVER_LATE.authority, acknowledgedInputSequence: 11442 },
        },
        TARGET,
        'KeyS',
      ),
    ).toBe(false);
    expect(
      matchesEquipmentRouteArrival(
        OUTER_BASELINE,
        { ...CLIENT_REACHED_SERVER_LATE, serverPlayerPosition: CLIENT_REACHED_SERVER_LATE.player, onGround: false },
        TARGET,
        'KeyS',
      ),
    ).toBe(false);
    expect(
      matchesEquipmentRouteArrival(
        OUTER_BASELINE,
        { ...CLIENT_REACHED_SERVER_LATE, serverPlayerPosition: CLIENT_REACHED_SERVER_LATE.player, colliding: true },
        TARGET,
        'KeyS',
      ),
    ).toBe(false);
  });
});

function farFromTarget(): ClassicSnapshot {
  return snapshot([79.5, 32.6, -0.5], 1, 1, [79.5, 32.6, -0.5], 0);
}
