import type { Page } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { walkTo, type ClassicSnapshot } from './harness';
import { lockPointer } from './mouse-input';
import { correctMouseToRoute, horizontalMouseCorrectionToRoute } from './target-aim';
import type { Point, RoutePoint } from './scenario';

const SENSITIVITY = 0.13;

type RouteObservation = Readonly<{ player: Point; viewAngles: readonly [number, number] }>;

const observation = (player: Point, yaw: number): RouteObservation => ({ player, viewAngles: [yaw, -26.79] });

const BROWSER20_OBSERVATIONS: readonly RouteObservation[] = [
  observation([69.55583739362123, 32.6, 0.5851294206764114], 41.17000000000004),
  observation([69.39230994509148, 32.6, 0.38707929317700357], 30.77000000000004),
  observation([69.39230994509148, 32.6, 0.38617787241326273], 20.37000000000004),
  observation([69.39230994509148, 32.6, 0.38617787241326273], 9.97000000000004),
  observation([69.39230994509148, 32.6, 0.38617787241326273], -0.42999999999996064),
  observation([69.39230994509148, 32.6, 0.38617787241326273], -10.829999999999961),
  observation([69.39230994509148, 32.6, 0.38617787241326273], -21.22999999999996),
  observation([69.39230994509148, 32.6, 0.38617787241326273], -31.62999999999996),
  observation([69.39230994509148, 32.6, 0.38617787241326273], -42.02999999999996),
  observation([69.39230994509148, 32.6, 0.38617787241326273], -52.42999999999996),
  observation([69.39230994509148, 32.6, 0.38617787241326273], -62.829999999999956),
  observation([69.39230994509148, 32.6, 0.38617787241326273], -73.22999999999996),
  observation([69.39230994509148, 32.6, 0.38617787241326273], -83.62999999999997),
];

const routeSnapshot = (player: Point, yaw: number, tick: number, ack: number): ClassicSnapshot =>
  ({
    player,
    serverPlayerPosition: player,
    viewAngles: [yaw, -20],
    onGround: true,
    colliding: false,
    interactionAttempts: 1,
    authority: { physicsTick: tick, acknowledgedInputSequence: ack, commitSequence: 1 },
  }) as unknown as ClassicSnapshot;

function nonResponsiveRoutePage(refreshAfterCorrection: boolean) {
  const target: RoutePoint = [1, 0];
  const initial = routeSnapshot([0, 32.6, 0], -89.74, 1, 1);
  const reached = routeSnapshot([1, 32.6, 0], -89.74, 2, 2);
  const calls = { reads: 0, down: 0, up: 0, moves: 0, pressed: false, pointerLocked: false };
  const page = {
    evaluate: async (callback: (...args: unknown[]) => unknown) => {
      const source = String(callback);
      if (source.includes('pointerLockElement')) return calls.pointerLocked;
      if (source.includes('snapshot()')) {
        calls.reads += 1;
        return calls.pressed ? reached : initial;
      }
      return undefined;
    },
    keyboard: {
      press: async () => undefined,
      down: async () => {
        calls.down += 1;
        calls.pressed = true;
      },
      up: async () => {
        calls.up += 1;
      },
    },
    locator: (selector: string) => ({
      isVisible: async () => false,
      boundingBox: async () => (selector === '#game' ? { x: 0, y: 0, width: 10_000, height: 540 } : null),
      click: async () => {
        calls.pointerLocked = true;
      },
    }),
    mouse: {
      move: async () => {
        calls.moves += 1;
      },
    },
    waitForFunction: async () => undefined,
  } as unknown as Page;
  return { calls, initial, page, target, options: refreshAfterCorrection ? { refreshAfterCorrection: true } : {} };
}

describe('Classic shared route aim bounded contract', () => {
  it('does not silently accept the exact Browser20 13-observation prefix', async () => {
    let read = 0;
    const moves: Array<readonly [number, number]> = [];

    await expect(
      correctMouseToRoute({
        target: [71.4925, 0.5],
        direction: 'KeyW',
        observe: async () => BROWSER20_OBSERVATIONS[read++] ?? null,
        move: async (dx, dy) => {
          moves.push([dx, dy]);
        },
      }),
    ).rejects.toThrow('route aim observation remained unavailable');

    expect(read).toBe(19);
    expect(moves).toHaveLength(13);
    expect(moves.slice(0, 12)).toEqual(Array.from({ length: 12 }, () => [80, 0]));
    expect(moves[12]?.[0]).toBeCloseTo(72.86287224169372, 9);
  });

  it.each([
    { name: 'W +X +180 wrap', direction: 'KeyW' as const, target: [1, 0] as RoutePoint, yaw: 90 },
    { name: 'W -X -180 wrap', direction: 'KeyW' as const, target: [-1, 0] as RoutePoint, yaw: -90 },
    { name: 'W +Z +180 wrap', direction: 'KeyW' as const, target: [0, 1] as RoutePoint, yaw: 0 },
    { name: 'W -Z +180 wrap', direction: 'KeyW' as const, target: [0, -1] as RoutePoint, yaw: 180 },
    { name: 'S +X -180 wrap', direction: 'KeyS' as const, target: [1, 0] as RoutePoint, yaw: -90 },
    { name: 'S -X +180 wrap', direction: 'KeyS' as const, target: [-1, 0] as RoutePoint, yaw: 90 },
    { name: 'S +Z +180 wrap', direction: 'KeyS' as const, target: [0, 1] as RoutePoint, yaw: 180 },
    { name: 'S -Z -180 wrap', direction: 'KeyS' as const, target: [0, -1] as RoutePoint, yaw: 0 },
  ])('covers the fixed-pose full yaw domain for $name', async ({ direction, target, yaw: initialYaw }) => {
    let yaw = initialYaw;
    let reads = 0;
    let moves = 0;

    const result = await correctMouseToRoute({
      target,
      direction,
      observe: async () => {
        reads += 1;
        return observation([0, 32.6, 0], yaw);
      },
      move: async (dx) => {
        moves += 1;
        yaw -= dx * SENSITIVITY;
      },
    });

    expect(moves).toBe(18);
    expect(reads).toBe(19);
    expect(result.kind).toBe('angle-aligned');
    expect(Math.abs(horizontalMouseCorrectionToRoute([0, 32.6, 0], yaw, target, direction))).toBeLessThan(1);
  });

  it('recovers after a transient null within the shared observation bound', async () => {
    let yaw = -79.6;
    let reads = 0;
    let moves = 0;

    const result = await correctMouseToRoute({
      target: [1, 0],
      direction: 'KeyW',
      observe: async () => {
        reads += 1;
        return reads === 1 ? null : observation([0, 32.6, 0], yaw);
      },
      move: async (dx) => {
        moves += 1;
        yaw -= dx * SENSITIVITY;
      },
    });

    expect({ reads, moves }).toEqual({ reads: 3, moves: 1 });
    expect(result.kind).toBe('angle-aligned');
  });

  it('fails unavailable after 19 persistent null observations without moving', async () => {
    let reads = 0;
    let moves = 0;
    await expect(
      correctMouseToRoute({
        target: [1, 0],
        direction: 'KeyW',
        observe: async () => {
          reads += 1;
          return null;
        },
        move: async () => {
          moves += 1;
        },
      }),
    ).rejects.toThrow('route aim observation remained unavailable');
    expect({ reads, moves }).toEqual({ reads: 19, moves: 0 });
  });

  it('fails exhaustion after 18 no-response moves and the final observation', async () => {
    let reads = 0;
    let moves = 0;
    await expect(
      correctMouseToRoute({
        target: [1, 0],
        direction: 'KeyW',
        observe: async () => {
          reads += 1;
          return observation([0, 32.6, 0], 90);
        },
        move: async () => {
          moves += 1;
        },
      }),
    ).rejects.toThrow('route aim did not converge');
    expect({ reads, moves }).toEqual({ reads: 19, moves: 18 });
  });

  it.each([
    {
      name: 'non-finite target',
      target: [Number.NaN, 0] as RoutePoint,
      current: observation([0, 32.6, 0], 0),
      message: 'route aim target is invalid',
    },
    {
      name: 'non-finite player',
      target: [1, 0] as RoutePoint,
      current: observation([Number.POSITIVE_INFINITY, 32.6, 0], 0),
      message: 'route aim observation is invalid',
    },
    {
      name: 'non-finite yaw',
      target: [1, 0] as RoutePoint,
      current: observation([0, 32.6, 0], Number.NaN),
      message: 'route aim observation is invalid',
    },
  ])('fails closed for $name without mutating source input', async ({ target, current, message }) => {
    const targetBefore = [...target];
    const currentBefore = structuredClone(current);
    let moves = 0;

    await expect(
      correctMouseToRoute({
        target,
        direction: 'KeyW',
        observe: async () => current,
        move: async () => {
          moves += 1;
        },
      }),
    ).rejects.toThrow(message);

    expect(target).toEqual(targetBefore);
    expect(current).toEqual(currentBefore);
    expect(moves).toBe(0);
  });

  it('rejects an exact zero route vector but accepts an aligned finite near-zero vector', async () => {
    const player: Point = [1, 32.6, 2];
    await expect(
      correctMouseToRoute({
        target: [1, 2],
        direction: 'KeyW',
        observe: async () => observation(player, 0),
        move: async () => undefined,
      }),
    ).rejects.toThrow('route aim direction is undefined');

    let moves = 0;
    const aligned = observation(player, -90);
    await expect(
      correctMouseToRoute({
        target: [1 + Number.EPSILON, 2],
        direction: 'KeyW',
        observe: async () => aligned,
        move: async () => {
          moves += 1;
        },
      }),
    ).resolves.toEqual({ kind: 'angle-aligned', observation: aligned });
    expect(moves).toBe(0);
  });

  it.each([
    { name: 'default', refreshAfterCorrection: false },
    { name: 'Close10 refresh', refreshAfterCorrection: true },
  ])('propagates helper exhaustion before $name walk input', async ({ refreshAfterCorrection }) => {
    const { calls, page, target, options } = nonResponsiveRoutePage(refreshAfterCorrection);
    await lockPointer(page);

    await expect(walkTo(page, target, { key: 'KeyW', timeout: 45_000, pulseMs: 0, ...options })).rejects.toThrow(
      'route aim did not converge',
    );
    expect(calls).toMatchObject({ down: 0, up: 0, moves: 18 });
  });
});
