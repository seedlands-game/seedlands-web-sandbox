import { describe, expect, it } from 'vitest';
import { classifyEquipmentRouteWait, followEquipmentRoute } from './equipment-resource-route';
import type { Point, RoutePoint } from './scenario';

const target: RoutePoint = [94.5, -0.5];
const routeSnapshot = (position: Point, physicsTick: number, ack: number, serverPosition = position) => ({
  player: position,
  serverPlayerPosition: serverPosition,
  onGround: true,
  colliding: false,
  authority: { physicsTick, acknowledgedInputSequence: ack },
});

describe('Classic V2 equipment arrival drift', () => {
  it('returns client drift from the Browser-17 wait stream before the bounded wait expires', async () => {
    let now = 1000;
    const initial = routeSnapshot([94.586637, 32.6, -0.225486], 16748, 9980);
    const walked = routeSnapshot(
      [94.45967102050781, 32.599998474121094, -0.505328357219696],
      16754,
      9986,
      [94.52751791462997, 32.6, -0.30881927104446866],
    );
    const stream = [
      walked,
      routeSnapshot(
        [94.45094299316406, 32.599998474121094, -0.6365221738815308],
        16757,
        9989,
        [94.45967187683496, 32.6, -0.5053283343049474],
      ),
      routeSnapshot(
        [94.45094299316406, 32.599998474121094, -0.6545403003692627],
        16760,
        9992,
        [94.45094541979219, 32.6, -0.6545403172740075],
      ),
    ];
    const walks: string[] = [];

    await expect(
      followEquipmentRoute(target, {
        now: () => now,
        observe: async () => initial,
        walk: async (direction) => {
          walks.push(direction);
          now += 100;
          return walks.length === 1 ? walked : routeSnapshot([94.5, 32.6, -0.5], 16761, 9993);
        },
        waitForProgress: async (baseline, direction, timeout) => {
          for (const snapshot of stream) {
            now += 100;
            const result = classifyEquipmentRouteWait(baseline, snapshot, target, direction);
            if (result) return result;
          }
          now += timeout;
          throw new Error('fullmatch-only wait timed out');
        },
      }),
    ).resolves.toMatchObject({ player: [94.5, 32.6, -0.5] });
    expect(walks).toEqual(['KeyS', 'KeyW']);
  });

  it.each([
    {
      name: 'z corridor',
      current: routeSnapshot([94.45, 32.6, -0.636522], 16757, 9989, [94.46, 32.6, -0.505328]),
    },
    {
      name: 'finite x neighborhood',
      current: routeSnapshot([95.01, 32.6, -0.5], 16757, 9989, [94.5, 32.6, -0.5]),
    },
  ])('classifies fresh ready client drift outside the $name', ({ current }) => {
    const walked = routeSnapshot([94.46, 32.6, -0.5], 16754, 9986, [94.53, 32.6, -0.31]);
    expect(classifyEquipmentRouteWait(walked, current, target, 'KeyW')).toEqual({
      kind: 'drift',
      snapshot: current,
    });
  });

  it('rejects stale, ack-regressed, and unready samples as drift', () => {
    const walked = routeSnapshot([94.46, 32.6, -0.5], 16754, 9986, [94.53, 32.6, -0.31]);
    const drift = routeSnapshot([94.45, 32.6, -0.64], 16757, 9989, [94.46, 32.6, -0.5]);
    expect(
      classifyEquipmentRouteWait(
        walked,
        { ...drift, authority: { ...drift.authority, physicsTick: walked.authority.physicsTick } },
        target,
        'KeyW',
      ),
    ).toBeNull();
    expect(
      classifyEquipmentRouteWait(
        walked,
        { ...drift, authority: { ...drift.authority, acknowledgedInputSequence: 9985 } },
        target,
        'KeyW',
      ),
    ).toBeNull();
    expect(classifyEquipmentRouteWait(walked, { ...drift, onGround: false }, target, 'KeyW')).toBeNull();
    expect(classifyEquipmentRouteWait(walked, { ...drift, colliding: true }, target, 'KeyW')).toBeNull();
  });

  it('keeps waiting when the client stays arrived and only the server is late', () => {
    const walked = routeSnapshot([94.46, 32.6, -0.5], 16754, 9986, [94.53, 32.6, -0.31]);
    const serverLate = routeSnapshot([94.46, 32.6, -0.5], 16757, 9989, [94.5, 32.6, -0.31]);
    expect(classifyEquipmentRouteWait(walked, serverLate, target, 'KeyW')).toBeNull();
  });

  it('cannot extend repeated drift corrections past the original route deadline', async () => {
    let now = 1000;
    let walks = 0;
    const initial = routeSnapshot([94, 32.6, -0.5], 100, 50);
    await expect(
      followEquipmentRoute(target, {
        now: () => now,
        observe: async () => initial,
        walk: async (direction, timeout) => {
          walks += 1;
          expect(timeout).toBe(45_000 - (walks - 1) * 10_000);
          now += 5000;
          return routeSnapshot(
            [direction === 'KeyW' ? 94.5 : 94.45, 32.6, -0.5],
            100 + walks * 2,
            50 + walks,
            [94.5, 32.6, -0.31],
          );
        },
        waitForProgress: async (walked) => {
          now += 5000;
          return {
            kind: 'drift',
            snapshot: routeSnapshot(
              [walked.player[0], 32.6, -0.64],
              walked.authority.physicsTick + 1,
              walked.authority.acknowledgedInputSequence,
            ),
          };
        },
      }),
    ).rejects.toThrow('Equipment route timed out');
    expect(walks).toBe(5);
  });
});
