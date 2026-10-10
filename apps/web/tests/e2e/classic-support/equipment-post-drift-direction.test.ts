import { describe, expect, it } from 'vitest';
import {
  classifyEquipmentRouteWait,
  followEquipmentRoute,
  type EquipmentRouteSnapshot,
} from './equipment-resource-route';
import { horizontalMouseCorrectionToRoute } from './target-aim';
import type { Point, RoutePoint } from './scenario';

const TARGET: RoutePoint = [78.5, 0.5];

const routeSnapshot = (
  player: Point,
  physicsTick: number,
  ack: number,
  serverPlayerPosition: Point,
  yaw: number,
): EquipmentRouteSnapshot & Readonly<{ viewAngles: readonly [number, number] }> => ({
  player,
  serverPlayerPosition,
  viewAngles: [yaw, -20.03],
  onGround: true,
  colliding: false,
  authority: { physicsTick, acknowledgedInputSequence: ack },
});

// Missing-heading cases exercise the x-based fallback while preserving the
// recorded observations. Only the test-driver clone omits the fresh heading.
const withoutHeading = (snapshot: EquipmentRouteSnapshot): EquipmentRouteSnapshot => {
  const copy = { ...snapshot };
  delete copy.viewAngles;
  return copy;
};

const OUTER_8674 = routeSnapshot(
  [78.55076599121094, 32.599998474121094, -0.49871936440467834],
  20342,
  13641,
  [78.55076243809718, 32.6, -0.4987193627433512],
  -1170.56,
);
const WALK_8880 = routeSnapshot(
  [Number('78.50784301757812'), 32.599998474121094, Number('0.5390361547470093')],
  20546,
  13854,
  [78.49858066153473, 32.6, 0.6640361514406132],
  -903.5399999999992,
);
const WAIT_8883 = routeSnapshot(
  [Number('78.50784301757812'), 32.599998474121094, Number('0.4834806025028229')],
  20546,
  13854,
  [78.49858066153473, 32.6, 0.6640361514406132],
  -903.5399999999992,
);
const DRIFT_8885 = routeSnapshot(
  [Number('78.50784301757812'), 32.599998474121094, Number('0.4140361547470093')],
  20549,
  13857,
  [78.50784246465534, 32.6, 0.48348059588505765],
  -903.5399999999992,
);
const WALK_9107 = routeSnapshot(
  [78.51006317138672, 32.599998474121094, 0.5390361547470093],
  20763,
  14081,
  [78.49146797116592, 32.6, 0.7057028181072799],
  -544.7399999999999,
);
const WAIT_9110 = routeSnapshot(
  [78.51006317138672, 32.599998474121094, 0.4834806025028229],
  20765,
  14083,
  [78.50386311264111, 32.6, 0.6084805958850577],
  -544.7399999999999,
);
const DRIFT_9112 = routeSnapshot(
  [78.51006317138672, 32.599998474121094, 0.4140361547470093],
  20766,
  14084,
  [78.51006068337871, 32.6, 0.5390361514406132],
  -544.7399999999999,
);

const classifyStream = (snapshots: readonly EquipmentRouteSnapshot[]) => {
  let index = 0;
  return async (baseline: EquipmentRouteSnapshot, direction: 'KeyW' | 'KeyS') => {
    while (index < snapshots.length) {
      const current = snapshots[index++]!;
      const result = classifyEquipmentRouteWait(baseline, current, TARGET, direction);
      if (result) return result;
    }
    throw new Error('Recorded wait stream ended without a classified result.');
  };
};

describe('Classic V2 post-drift route direction', () => {
  it.each([
    {
      name: 'first Browser22 outer wait',
      initial: OUTER_8674,
      walked: WALK_8880,
      waits: [WAIT_8883, DRIFT_8885],
      missingHeading: false,
    },
    {
      name: 'second Browser22 outer wait counterfactual fixture',
      initial: DRIFT_8885,
      walked: WALK_9107,
      waits: [WAIT_9110, DRIFT_9112],
      missingHeading: true,
    },
  ])('reverses one next movement after $name validates drift', async ({ initial, walked, waits, missingHeading }) => {
    const sentinel = new Error('post-drift direction sentinel');
    const directions: string[] = [];
    const snapshot = (value: EquipmentRouteSnapshot) => (missingHeading ? withoutHeading(value) : value);

    await expect(
      followEquipmentRoute(TARGET, {
        now: () => 1000,
        observe: async () => snapshot(initial),
        walk: async (direction) => {
          directions.push(direction);
          if (directions.length === 1) return snapshot(walked);
          throw sentinel;
        },
        waitForProgress: async (baseline, direction) => {
          const result = await classifyStream(waits.map(snapshot))(snapshot(baseline), direction);
          return { kind: result.kind, snapshot: snapshot(result.snapshot) };
        },
      }),
    ).rejects.toBe(sentinel);

    expect(directions).toEqual(['KeyS', 'KeyW']);
  });

  it('consumes the reverse hint once before returning to the x-based direction rule', async () => {
    const sentinel = new Error('one-shot direction sentinel');
    const ordinary = routeSnapshot([78.6, 32.6, 0.2], 20550, 13858, [78.6, 32.6, 0.2], -900);
    const directions: string[] = [];

    await expect(
      followEquipmentRoute(TARGET, {
        now: () => 1000,
        observe: async () => OUTER_8674,
        walk: async (direction) => {
          directions.push(direction);
          if (directions.length === 1) return WALK_8880;
          if (directions.length === 2) return ordinary;
          throw sentinel;
        },
        waitForProgress: classifyStream([WAIT_8883, DRIFT_8885]),
      }),
    ).rejects.toBe(sentinel);

    expect(directions).toEqual(['KeyS', 'KeyW', 'KeyS']);
  });

  it('uses one-shot reverse hints after consecutive validated drift when heading is unavailable', async () => {
    const sentinel = new Error('alternating direction sentinel');
    const keyWReached = routeSnapshot([78.49, 32.6, 0.52], 20560, 13870, [78.49, 32.6, 0.7], -900);
    const keyWDrift = routeSnapshot([78.49, 32.6, 0.414], 20561, 13871, [78.49, 32.6, 0.52], -900);
    const directions: string[] = [];
    let waits = 0;

    await expect(
      followEquipmentRoute(TARGET, {
        now: () => 1000,
        observe: async () => withoutHeading(OUTER_8674),
        walk: async (direction) => {
          directions.push(direction);
          if (directions.length === 1) return withoutHeading(WALK_8880);
          if (directions.length === 2) return withoutHeading(keyWReached);
          throw sentinel;
        },
        waitForProgress: async (baseline, direction) => {
          waits += 1;
          const result = await (
            waits === 1
              ? classifyStream([DRIFT_8885].map(withoutHeading))
              : classifyStream([keyWDrift].map(withoutHeading))
          )(withoutHeading(baseline), direction);
          return { kind: result.kind, snapshot: withoutHeading(result.snapshot) };
        },
      }),
    ).rejects.toBe(sentinel);

    expect(directions).toEqual(['KeyS', 'KeyW', 'KeyS']);
  });

  it('lets fresh heading override the reverse hint after continuous Browser22 drift', async () => {
    const sentinel = new Error('fresh heading priority sentinel');
    const keyWReached = routeSnapshot([78.49, 32.6, 0.52], 20560, 13870, [78.49, 32.6, 0.7], -900);
    const keyWDrift = routeSnapshot([78.49, 32.6, 0.414], 20561, 13871, [78.49, 32.6, 0.52], -900);
    const directions: string[] = [];
    let waits = 0;

    await expect(
      followEquipmentRoute(TARGET, {
        now: () => 1000,
        observe: async () => OUTER_8674,
        walk: async (direction) => {
          directions.push(direction);
          if (directions.length === 1) return WALK_8880;
          if (directions.length === 2) return keyWReached;
          throw sentinel;
        },
        waitForProgress: async (baseline, direction) => {
          waits += 1;
          return waits === 1
            ? classifyStream([WAIT_8883, DRIFT_8885])(baseline, direction)
            : classifyStream([keyWDrift])(baseline, direction);
        },
      }),
    ).rejects.toBe(sentinel);

    // The latest -900° heading points toward +Z. A stale reverse hint would choose S.
    expect(directions).toEqual(['KeyS', 'KeyW', 'KeyW']);
  });

  it('keeps driver rejection identity and does not enter the wait path', async () => {
    const rejection = new Error('Real input route timed out before 78.5,0.5.');
    let waits = 0;
    const pending = followEquipmentRoute(TARGET, {
      now: () => 1000,
      observe: async () => OUTER_8674,
      walk: async () => Promise.reject(rejection),
      waitForProgress: async () => {
        waits += 1;
        return { kind: 'drift', snapshot: DRIFT_8885 };
      },
    });

    await expect(pending).rejects.toBe(rejection);
    expect(waits).toBe(0);
  });

  it.each([DRIFT_8885, DRIFT_9112])('shows the recorded drift is cheaper to correct with KeyW', (current) => {
    const keyW = horizontalMouseCorrectionToRoute(current.player, current.viewAngles[0], TARGET, 'KeyW');
    const keyS = horizontalMouseCorrectionToRoute(current.player, current.viewAngles[0], TARGET, 'KeyS');

    expect(Math.abs(keyW)).toBeLessThan(16);
    expect(Math.abs(keyS)).toBe(80);
  });
});
