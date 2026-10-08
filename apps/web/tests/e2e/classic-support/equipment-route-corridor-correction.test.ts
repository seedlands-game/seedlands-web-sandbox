import { expect, it } from 'vitest';
import { followEquipmentRoute, type EquipmentRouteSnapshot } from './equipment-resource-route';
import type { Point, RoutePoint } from './scenario';

const TARGET: RoutePoint = [78.5, -0.5];
const INITIAL: Point = [78.50037892536223, 32.6, 0.5677718721688696];
const ARRIVAL: Point = [78.5, 32.6, -0.5];
const INITIAL_SERVER: Point = [78.50037892536223, 32.6, 0.5677718721688696];

const snapshot = (
  player: Point,
  serverPlayerPosition: Point,
  physicsTick: number,
  acknowledgedInputSequence: number,
  yaw?: number,
): EquipmentRouteSnapshot => ({
  player,
  serverPlayerPosition,
  ...(yaw === undefined ? {} : { viewAngles: [yaw, -20] as const }),
  onGround: true,
  colliding: false,
  authority: { physicsTick, acknowledgedInputSequence },
});

it('chooses the route heading from fresh yaw when sub-corridor x noise points the opposite way', async () => {
  const initial = snapshot(INITIAL, INITIAL_SERVER, 24_212, 33_121, 0.09000000000004849);
  const reached = snapshot(ARRIVAL, ARRIVAL, 24_220, 33_129, initial.viewAngles![0]);
  const directions: string[] = [];

  const result = await followEquipmentRoute(TARGET, {
    now: () => 1_000,
    observe: async () => initial,
    walk: async (direction) => {
      directions.push(direction);
      // At this heading, KeyW moves toward the corridor target. The old x-only
      // selector asks for KeyS because the measured x is 0.000379m past target.
      expect(direction).toBe('KeyW');
      return reached;
    },
    waitForProgress: async () => {
      throw new Error('A fresh dual-position arrival must not enter the outer wait.');
    },
  });

  expect(directions).toEqual(['KeyW']);
  expect(result.player).toEqual(ARRIVAL);
  expect(result.serverPlayerPosition).toEqual(ARRIVAL);
  expect(result.onGround).toBe(true);
  expect(result.colliding).toBe(false);
});

it('chooses the symmetric reverse heading when x noise favors KeyW', async () => {
  const initial = snapshot([78.4996, 32.6, 0.5677718721688696], [78.4996, 32.6, 0.5677718721688696], 10, 20, 180);
  const reached = snapshot(ARRIVAL, ARRIVAL, 18, 28, 180);
  const directions: string[] = [];

  await expect(
    followEquipmentRoute(TARGET, {
      now: () => 1_000,
      observe: async () => initial,
      walk: async (direction) => {
        directions.push(direction);
        expect(direction).toBe('KeyS');
        return reached;
      },
      waitForProgress: async () => {
        throw new Error('A dual-position arrival must not wait.');
      },
    }),
  ).resolves.toEqual(reached);
  expect(directions).toEqual(['KeyS']);
});

it.each([
  { heading: 'missing', yaw: undefined },
  { heading: 'non-finite', yaw: Number.NaN },
])('falls back to the original x selector when yaw is $heading', async ({ yaw }) => {
  const initial = snapshot(INITIAL, INITIAL_SERVER, 24_212, 33_121, yaw);
  const reached = snapshot(ARRIVAL, ARRIVAL, 24_220, 33_129, yaw);
  const directions: string[] = [];

  await expect(
    followEquipmentRoute(TARGET, {
      now: () => 1_000,
      observe: async () => initial,
      walk: async (direction) => {
        directions.push(direction);
        expect(direction).toBe('KeyS');
        return reached;
      },
      waitForProgress: async () => {
        throw new Error('A dual-position arrival must not wait.');
      },
    }),
  ).resolves.toEqual(reached);
  expect(directions).toEqual(['KeyS']);
});

it('does not accept a fresh player-only arrival from the outer route driver', async () => {
  const initial = snapshot(INITIAL, INITIAL_SERVER, 24_212, 33_121, 0.09000000000004849);
  const playerOnlyArrival = snapshot(ARRIVAL, INITIAL_SERVER, 24_220, 33_129, initial.viewAngles![0]);

  await expect(
    followEquipmentRoute(TARGET, {
      now: () => 1_000,
      observe: async () => initial,
      walk: async (direction) => {
        expect(direction).toBe('KeyW');
        return playerOnlyArrival;
      },
      waitForProgress: async () => ({ kind: 'arrival', snapshot: playerOnlyArrival }),
    }),
  ).rejects.toThrow('Equipment route wait returned a non-matching snapshot.');
});
