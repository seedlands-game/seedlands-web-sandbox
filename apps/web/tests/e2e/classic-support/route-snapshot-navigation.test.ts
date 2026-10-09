import type { Page } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import type { BrowserAuthorityClient } from '../../../src/client/authority/browser-authority-client';
import { createHarnessRouteSnapshot, createHarnessSnapshot } from '../../../src/app/game-harness';
import type { PlayerController } from '../../../src/app/player/player-controller';
import type { AuthoritySnapshot } from '../../../../../packages/stdlib/src/server/authority/authority-session';
import { routeSnapshot as readRouteSnapshot, snapshot as readFullSnapshot, walkRouteTo, walkTo } from './harness';
import { classifyEquipmentRouteWait, matchesEquipmentRouteArrival } from './equipment-resource-route';
import { routeInputSettled } from './route-progress';
import type { HarnessSnapshot } from '../../../src/app/app-contracts';

type Route = NonNullable<ReturnType<typeof createHarnessRouteSnapshot>>;
type OwnerOptions = Partial<{
  player: readonly [number, number, number];
  serverPlayer: readonly [number, number, number];
  velocity: readonly [number, number, number];
  view: readonly [number, number];
  physicsTick: number;
  acknowledgedInputSequence: number;
  onGround: boolean;
  colliding: boolean;
  controllerPresent: boolean;
  authorityReady: boolean;
}>;

function ownerContext(options: OwnerOptions = {}) {
  const player = options.player ?? ([10, 32.6, 10] as const);
  const serverPlayer = options.serverPlayer ?? player;
  const controller =
    options.controllerPresent === false
      ? null
      : ({
          position: { x: player[0], y: player[1], z: player[2] },
          viewAngles: options.view ?? ([0, -16] as const),
          onGround: options.onGround ?? true,
          isColliding: options.colliding ?? false,
        } as unknown as PlayerController);
  const authoritySnapshot = {
    player: {
      body: {
        position: { x: serverPlayer[0], y: serverPlayer[1] - 1.6, z: serverPlayer[2] },
        velocity: {
          x: (options.velocity ?? [0, 0, 0])[0],
          y: options.velocity?.[1] ?? 0,
          z: options.velocity?.[2] ?? 0,
        },
      },
    },
    entities: [],
    physicsTick: options.physicsTick ?? 4,
    acknowledgedInputSequence: options.acknowledgedInputSequence ?? 7,
    diagnostics: {},
  } as unknown as AuthoritySnapshot;
  const authority =
    options.authorityReady === false
      ? null
      : ({
          isReady: true,
          snapshot: authoritySnapshot,
          readyState: null,
          snapshotRejections: {},
          storageBytes: 0,
        } as unknown as BrowserAuthorityClient);
  return {
    controller,
    authority,
    authoritySnapshot,
    context: {
      world: null,
      environment: null,
      controller,
      frameMs: 16,
      qualityLevel: 'medium' as const,
      authority,
      compute: null,
      logic: null,
      authorityTrajectory: [],
      ui: {} as never,
      presentedEntityCount: 0,
      visualEffects: null,
      underwaterVisual: null,
    },
  };
}

function routePair(options: OwnerOptions = {}) {
  const source = ownerContext(options);
  return {
    route: createHarnessRouteSnapshot(source.context)!,
    full: createHarnessSnapshot(source.context),
  };
}

const projectFull = (full: HarnessSnapshot): Route => ({
  player: full.player,
  serverPlayerPosition: full.serverPlayerPosition,
  serverPlayerVelocity: full.serverPlayerVelocity,
  viewAngles: full.viewAngles,
  onGround: full.onGround,
  colliding: full.colliding,
  authority: {
    physicsTick: full.authority.physicsTick,
    acknowledgedInputSequence: full.authority.acknowledgedInputSequence,
  },
});

describe('route snapshot preserves route gates and actual helper reads', () => {
  it.each([
    [
      'dual endpoint arrival',
      { player: [10.2, 32.6, 10], serverPlayer: [10.2, 32.6, 10], physicsTick: 5, acknowledgedInputSequence: 7 },
      true,
      'arrival',
    ],
    ['client-only arrival', { player: [10.2, 32.6, 10], serverPlayer: [10, 32.6, 10], physicsTick: 5 }, false, null],
    ['server-only arrival', { player: [10, 32.6, 10], serverPlayer: [10.2, 32.6, 10], physicsTick: 5 }, false, 'drift'],
    ['stale tick', { player: [10.2, 32.6, 10], serverPlayer: [10.2, 32.6, 10], physicsTick: 4 }, false, null],
    [
      'stale acknowledgement',
      { player: [10.2, 32.6, 10], serverPlayer: [10.2, 32.6, 10], physicsTick: 5, acknowledgedInputSequence: 6 },
      false,
      null,
    ],
    [
      'airborne',
      { player: [10.2, 32.6, 10], serverPlayer: [10.2, 32.6, 10], physicsTick: 5, onGround: false },
      false,
      null,
    ],
    [
      'colliding',
      { player: [10.2, 32.6, 10], serverPlayer: [10.2, 32.6, 10], physicsTick: 5, colliding: true },
      false,
      null,
    ],
  ] as const)(
    '%s has identical unchanged decisions for full and route observations',
    (_name, currentOptions, expectedArrival, expectedWait) => {
      const baseline = routePair();
      const current = routePair(currentOptions);
      expect(current.route).toEqual(projectFull(current.full));
      const fullArrival = matchesEquipmentRouteArrival(baseline.full, current.full, [10.2, 10], 'KeyW');
      const routeArrival = matchesEquipmentRouteArrival(baseline.route, current.route, [10.2, 10], 'KeyW');
      expect(fullArrival).toBe(expectedArrival);
      expect(routeArrival).toBe(fullArrival);
      const fullWait = classifyEquipmentRouteWait(baseline.full, current.full, [10.2, 10], 'KeyW')?.kind ?? null;
      const routeWait = classifyEquipmentRouteWait(baseline.route, current.route, [10.2, 10], 'KeyW')?.kind ?? null;
      expect(fullWait).toBe(expectedWait);
      expect(routeWait).toBe(fullWait);
    },
  );

  it.each([
    ['Authority is still moving', { velocity: [0.01, 0, 0] }, false],
    ['presentation pose differs from Authority', { player: [10.06, 32.6, 10], serverPlayer: [10, 32.6, 10] }, false],
    ['settled and dual poses agree', { player: [10.02, 32.6, 10], serverPlayer: [10.02, 32.6, 10] }, true],
  ] as const)('pulse-settle predicate %s stays identical', (_name, options, expected) => {
    const { route, full } = routePair(options);
    expect(routeInputSettled(route)).toBe(expected);
    expect(routeInputSettled(full)).toBe(expected);
  });

  it('the actual full and route walk APIs emit identical mouse/key events and finish on the same owner pose', async () => {
    const run = async (routeOnly: boolean) => {
      const player: { x: number; y: number; z: number } = { x: 78.4, y: 32.6, z: -0.5 };
      const viewAngles: [number, number] = [-88, -16];
      const authorityState = {
        player: { body: { position: { x: player.x, y: player.y - 1.6, z: player.z }, velocity: { x: 0, y: 0, z: 0 } } },
        entities: [],
        physicsTick: 4,
        acknowledgedInputSequence: 7,
        diagnostics: {},
      };
      const authoritySnapshot = authorityState as unknown as AuthoritySnapshot;
      const controller = {
        get position() {
          return { ...player };
        },
        get viewAngles() {
          return [...viewAngles] as [number, number];
        },
        onGround: true,
        isColliding: false,
      } as unknown as PlayerController;
      const authority = {
        isReady: true,
        snapshot: authoritySnapshot,
        readyState: null,
        snapshotRejections: {},
        storageBytes: 0,
      } as unknown as BrowserAuthorityClient;
      const context = {
        world: null,
        environment: null,
        controller,
        frameMs: 16,
        qualityLevel: 'medium' as const,
        authority,
        compute: null,
        logic: null,
        authorityTrajectory: [],
        ui: {} as never,
        presentedEntityCount: 0,
        visualEffects: null,
        underwaterVisual: null,
      };
      let pointerLocked = false;
      let mouseX = 50;
      const mouseEvents: number[] = [];
      const keyEvents: string[] = [];
      const page = {
        locator: (selector: string) => ({
          isVisible: async () => (selector === '#debug' ? false : false),
          boundingBox: async () => ({ x: 0, y: 0, width: 100, height: 100 }),
          click: async () => {
            pointerLocked = true;
          },
        }),
        waitForFunction: async () => undefined,
        mouse: {
          move: async (x: number) => {
            const delta = x - mouseX;
            mouseX = x;
            viewAngles[0] -= delta * 0.13;
            mouseEvents.push(delta);
          },
        },
        keyboard: {
          down: async (key: string) => {
            keyEvents.push(`down:${key}`);
            if (key === 'KeyW') {
              player.x = 78.5;
              authorityState.player.body.position.x = player.x;
              authorityState.physicsTick += 1;
              authorityState.acknowledgedInputSequence += 1;
            }
          },
          up: async (key: string) => {
            keyEvents.push(`up:${key}`);
          },
        },
        evaluate: async (callback: () => unknown) => {
          const source = String(callback);
          if (source.includes('pointerLockElement')) return pointerLocked;
          if (source.includes('routeSnapshot()')) return createHarnessRouteSnapshot({ controller, authority });
          if (source.includes('snapshot()')) return createHarnessSnapshot(context);
          if (source.includes('requestAnimationFrame')) return undefined;
          throw new Error(`Unexpected fake Page evaluate: ${source}`);
        },
      } as unknown as Page;
      await (await import('./mouse-input')).lockPointer(page);
      const result = routeOnly
        ? await walkRouteTo(page, [78.5, -0.5], { key: 'KeyW', tolerance: 0.06, corridorTolerance: 0.08, pulseMs: 1 })
        : await walkTo(page, [78.5, -0.5], { key: 'KeyW', tolerance: 0.06, corridorTolerance: 0.08, pulseMs: 1 });
      return { result, mouseEvents, keyEvents };
    };
    const full = await run(false);
    const route = await run(true);
    expect(route.mouseEvents).toEqual(full.mouseEvents);
    expect(route.keyEvents).toEqual(full.keyEvents);
    expect(route.keyEvents).toEqual(['down:KeyW', 'up:KeyW']);
    expect(route.result).toMatchObject({ player: [78.5, 32.6, -0.5], serverPlayerPosition: [78.5, 32.6, -0.5] });
    expect(projectFull(full.result as HarnessSnapshot)).toEqual(route.result);
  });

  it('unavailable route observation fails before any input is sent', async () => {
    const events: string[] = [];
    const page = {
      evaluate: async () => null,
      keyboard: { down: async (key: string) => events.push(key), up: async () => undefined },
      mouse: { move: async () => events.push('mouse') },
    } as unknown as Page;
    expect(await readRouteSnapshot(page)).toBeNull();
    await expect(walkRouteTo(page, [2, 3])).rejects.toThrow('Classic snapshot is unavailable before route movement.');
    expect(events).toEqual([]);
    // The full API remains distinct and is still the failure-diagnostic route.
    expect(await readFullSnapshot(page)).toBeNull();
  });
});
