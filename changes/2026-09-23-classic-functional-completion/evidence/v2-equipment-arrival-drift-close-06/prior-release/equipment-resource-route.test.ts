import { describe, expect, it } from 'vitest';
import { bodyConfigFor } from '@seedlands/stdlib/physics/body-registry';
import { reachedRouteTarget } from './route-progress';
import {
  equipmentResourcePickup,
  equipmentRouteNeighborhoodClearsVoxels,
  equipmentRouteDirection,
  equipmentRouteSegmentClearsVoxels,
  equipmentWorkbenchCorridor,
  equipmentWorkbenchMiningApproach,
  EQUIPMENT_RESOURCE_ROUTE_OPTIONS,
  EQUIPMENT_ROUTE_MAX_X_ERROR,
  followEquipmentRoute,
  isEquipmentMiningReady,
  matchesEquipmentRouteArrival,
} from './equipment-resource-route';
import { classicScenario, type Point, type RoutePoint } from './scenario';

const browser15EastEnd: Point = [98.5, 32.6, -0.5];
const firstWoodApproach: RoutePoint = [80.5, -0.5];
const playerBody = bodyConfigFor('player').localAabb;
const playerHalfWidth = Math.max(-playerBody.min.x, playerBody.max.x, -playerBody.min.z, playerBody.max.z);
const routeSnapshot = (position: Point, physicsTick: number, ack: number, serverPosition = position) => ({
  player: position,
  serverPlayerPosition: serverPosition,
  onGround: true,
  colliding: false,
  authority: { physicsTick, acknowledgedInputSequence: ack },
});
const obstacle = (placement: Readonly<{ target: Point }>) => ({ position: placement.target });

describe('Classic V2 equipment resource route', () => {
  it('does not let the default eastbound crossing rule accept an east-to-west transition', () => {
    expect(
      reachedRouteTarget(
        browser15EastEnd,
        firstWoodApproach,
        'KeyW',
        EQUIPMENT_RESOURCE_ROUTE_OPTIONS.tolerance,
        EQUIPMENT_RESOURCE_ROUTE_OPTIONS.corridorTolerance,
      ),
    ).toBe(true);

    const direction = equipmentRouteDirection(browser15EastEnd, firstWoodApproach);
    expect(direction).toBe('KeyS');
    expect(
      reachedRouteTarget(
        browser15EastEnd,
        firstWoodApproach,
        direction,
        EQUIPMENT_RESOURCE_ROUTE_OPTIONS.tolerance,
        EQUIPMENT_RESOURCE_ROUTE_OPTIONS.corridorTolerance,
      ),
    ).toBe(false);
    expect(
      equipmentRouteSegmentClearsVoxels(
        [83.60385119512642, 1.4372953280896212],
        [77.2, 2.5],
        classicScenario.v2Equipment.resourceStrip.map(obstacle),
        playerHalfWidth,
      ),
    ).toBe(false);
  });

  it.each([
    { from: [78.5, 32.6, -0.5] as Point, target: [80.5, -0.5] as RoutePoint, expected: 'KeyW' },
    { from: browser15EastEnd, target: firstWoodApproach, expected: 'KeyS' },
  ])('chooses $expected for $from -> $target', ({ from, target, expected }) => {
    expect(equipmentRouteDirection(from, target)).toBe(expected);
  });

  it.each([
    { direction: 'KeyW' as const, position: [82.5, 32.6, -0.5] as Point },
    { direction: 'KeyS' as const, position: [78.5, 32.6, -0.5] as Point },
  ])('rejects an unbounded $direction crossing beyond the finite arrival neighborhood', ({ direction, position }) => {
    const baseline = routeSnapshot([direction === 'KeyW' ? 79 : 82, 32.6, -0.5], 100, 50);
    const current = routeSnapshot(position, 101, 50);
    expect(
      reachedRouteTarget(
        current.player,
        firstWoodApproach,
        direction,
        EQUIPMENT_RESOURCE_ROUTE_OPTIONS.tolerance,
        EQUIPMENT_RESOURCE_ROUTE_OPTIONS.corridorTolerance,
      ),
    ).toBe(true);
    expect(matchesEquipmentRouteArrival(baseline, current, firstWoodApproach, direction)).toBe(false);
  });

  it.each([
    { side: 'west', clientX: 80.441, serverX: 80.45, direction: 'KeyW' as const },
    { side: 'east', clientX: 80.559, serverX: 80.55, direction: 'KeyS' as const },
  ])('keeps both $side arrival projections fresh and inside mining range', ({ clientX, serverX, direction }) => {
    const target = classicScenario.v2Equipment.resourceStrip[0]!.target;
    const approach = classicScenario.v2Equipment.resourceStrip[0]!.approach;
    const baseline = routeSnapshot([direction === 'KeyW' ? 79 : 82, 32.6, -0.5], 100, 50);
    const current = routeSnapshot([clientX, 32.6, -0.5], 101, 50, [serverX, 32.600001, -0.5]);
    expect(matchesEquipmentRouteArrival(baseline, current, approach, direction)).toBe(true);
    expect(isEquipmentMiningReady(current, target)).toBe(true);
  });

  it('keeps both projected route-domain edges in mining range for all ten resources', () => {
    for (const resource of classicScenario.v2Equipment.resourceStrip) {
      for (const direction of ['KeyW', 'KeyS'] as const) {
        const sign = direction === 'KeyW' ? 1 : -1;
        const baseline = routeSnapshot([resource.approach[0] - sign * 2, 32.6, resource.approach[1]], 100, 50);
        const current = routeSnapshot(
          [
            resource.approach[0] + sign * (EQUIPMENT_ROUTE_MAX_X_ERROR - 0.001),
            32.6,
            resource.approach[1] + sign * 0.079,
          ],
          101,
          50,
          [resource.approach[0] + sign * 0.05, 32.600001, resource.approach[1] + sign * 0.07],
        );
        expect(matchesEquipmentRouteArrival(baseline, current, resource.approach, direction)).toBe(true);
        expect(isEquipmentMiningReady(current, resource.target)).toBe(true);
      }
    }
  });

  it('corrects an overshot walk with the opposite key inside one shared deadline', async () => {
    let now = 1000;
    const walks: Array<{ direction: string; timeout: number }> = [];
    const initial = routeSnapshot([79, 32.6, -0.5], 100, 50);
    const overshot = routeSnapshot([82.5, 32.6, -0.5], 101, 51);
    const corrected = routeSnapshot([80.5, 32.6, -0.5], 102, 51);
    const result = await followEquipmentRoute(firstWoodApproach, {
      now: () => now,
      observe: async () => initial,
      walk: async (direction, timeout) => {
        walks.push({ direction, timeout });
        now += 1000;
        return walks.length === 1 ? overshot : corrected;
      },
      waitForArrival: async () => {
        throw new Error('Overshot positions must be corrected with real input instead of stationary waiting.');
      },
    });

    expect(walks).toEqual([
      { direction: 'KeyW', timeout: 45000 },
      { direction: 'KeyS', timeout: 44000 },
    ]);
    expect(result).toBe(corrected);
  });

  it('caps a server-projection wait by both 20 seconds and the shared route deadline', async () => {
    let now = 1000;
    const baseline = routeSnapshot([79, 32.6, -0.5], 100, 50);
    const serverLag = routeSnapshot([80.5, 32.6, -0.5], 101, 51, [80.1, 32.6, -0.5]);
    const matched = routeSnapshot([80.5, 32.6, -0.5], 102, 51);
    const waits: number[] = [];
    const result = await followEquipmentRoute(firstWoodApproach, {
      now: () => now,
      observe: async () => baseline,
      walk: async () => {
        now += 30000;
        return serverLag;
      },
      waitForArrival: async (_currentBaseline, _direction, timeout) => {
        waits.push(timeout);
        return matched;
      },
    });

    expect(waits).toEqual([15000]);
    expect(result).toBe(matched);
  });

  it.each([{ serverX: 79 }, { serverX: 82.5 }])(
    'waits for server x=$serverX without issuing a zero-input walk after the client arrives',
    async ({ serverX }) => {
      let now = 1000;
      const walks: Array<{ direction: string; timeout: number }> = [];
      const waits: Array<{ direction: string; timeout: number }> = [];
      const baseline = routeSnapshot([79, 32.6, -0.5], 100, 50);
      const serverOutside = routeSnapshot([80.5, 32.6, -0.5], 101, 51, [serverX, 32.6, -0.5]);
      const matched = routeSnapshot([80.55, 32.6, -0.5], 102, 51);
      let current = baseline;
      const result = await followEquipmentRoute(firstWoodApproach, {
        now: () => now,
        observe: async () => baseline,
        walk: async (direction, timeout) => {
          walks.push({ direction, timeout });
          now += 1000;
          if (
            reachedRouteTarget(
              current.player,
              firstWoodApproach,
              direction,
              EQUIPMENT_RESOURCE_ROUTE_OPTIONS.tolerance,
              EQUIPMENT_RESOURCE_ROUTE_OPTIONS.corridorTolerance,
            )
          )
            return current;
          current = serverOutside;
          return current;
        },
        waitForArrival: async (_currentBaseline, direction, timeout) => {
          waits.push({ direction, timeout });
          current = matched;
          return current;
        },
      });

      expect(walks).toEqual([{ direction: 'KeyW', timeout: 45000 }]);
      expect(waits).toEqual([{ direction: 'KeyW', timeout: 20000 }]);
      expect(result).toBe(matched);
    },
  );

  it('fails when the bounded wait does not bring the server projection into the finite neighborhood', async () => {
    let now = 1000;
    const baseline = routeSnapshot([79, 32.6, -0.5], 100, 50);
    const serverOutside = routeSnapshot([80.5, 32.6, -0.5], 101, 51, [79, 32.6, -0.5]);
    let walks = 0;
    let waits = 0;
    await expect(
      followEquipmentRoute(firstWoodApproach, {
        now: () => now,
        observe: async () => baseline,
        walk: async () => {
          walks += 1;
          now += 1000;
          return serverOutside;
        },
        waitForArrival: async () => {
          waits += 1;
          return { ...serverOutside, authority: { ...serverOutside.authority, physicsTick: 102 } };
        },
      }),
    ).rejects.toThrow('Equipment route wait returned a non-matching snapshot.');
    expect(walks).toBe(1);
    expect(waits).toBe(1);
  });

  it('charges a server-only projection wait to the same route deadline', async () => {
    let now = 1000;
    const baseline = routeSnapshot([79, 32.6, -0.5], 100, 50);
    const serverOutside = routeSnapshot([80.5, 32.6, -0.5], 101, 51, [79, 32.6, -0.5]);
    const matched = routeSnapshot([80.5, 32.6, -0.5], 102, 51);
    const waits: number[] = [];
    await expect(
      followEquipmentRoute(firstWoodApproach, {
        now: () => now,
        observe: async () => baseline,
        walk: async () => {
          now += 30000;
          return serverOutside;
        },
        waitForArrival: async (_currentBaseline, _direction, timeout) => {
          waits.push(timeout);
          now += timeout;
          return matched;
        },
      }),
    ).rejects.toThrow('Equipment route timed out');
    expect(waits).toEqual([15000]);
  });

  it('keeps walking when the client is finite but has not crossed in the active direction', async () => {
    let now = 1000;
    const baseline = routeSnapshot([79, 32.6, -0.5], 100, 50);
    const beforeCrossing = routeSnapshot([80.2, 32.6, -0.5], 101, 51);
    const matched = routeSnapshot([80.5, 32.6, -0.5], 102, 52);
    const walks: string[] = [];
    const result = await followEquipmentRoute(firstWoodApproach, {
      now: () => now,
      observe: async () => baseline,
      walk: async (direction) => {
        walks.push(direction);
        now += 1000;
        return walks.length === 1 ? beforeCrossing : matched;
      },
      waitForArrival: async () => {
        throw new Error('A client that has not crossed must continue through the real walk driver.');
      },
    });

    expect(walks).toEqual(['KeyW', 'KeyW']);
    expect(result).toBe(matched);
  });

  it('rejects a matching result returned after the shared route deadline', async () => {
    let now = 1000;
    const baseline = routeSnapshot([79, 32.6, -0.5], 100, 50);
    const matched = routeSnapshot([80.5, 32.6, -0.5], 101, 51);
    await expect(
      followEquipmentRoute(firstWoodApproach, {
        now: () => now,
        observe: async () => baseline,
        walk: async () => {
          now += 45_001;
          return matched;
        },
        waitForArrival: async () => matched,
      }),
    ).rejects.toThrow('Equipment route timed out');
  });

  it('rejects stale, unready, one-sided, and out-of-range arrival snapshots', () => {
    const resource = classicScenario.v2Equipment.resourceStrip[0]!;
    const baseline = routeSnapshot([79, 32.6, -0.5], 100, 50);
    const ready = routeSnapshot([80.5, 32.6, -0.5], 101, 50);
    expect(
      matchesEquipmentRouteArrival(
        baseline,
        { ...ready, authority: { ...ready.authority, physicsTick: 100 } },
        resource.approach,
        'KeyW',
      ),
    ).toBe(false);
    expect(matchesEquipmentRouteArrival(baseline, { ...ready, onGround: false }, resource.approach, 'KeyW')).toBe(
      false,
    );
    expect(
      matchesEquipmentRouteArrival(
        baseline,
        { ...ready, serverPlayerPosition: [79, 32.6, -0.5] },
        resource.approach,
        'KeyW',
      ),
    ).toBe(false);
    expect(
      matchesEquipmentRouteArrival(
        baseline,
        { ...ready, serverPlayerPosition: [82.5, 32.6, -0.5] },
        resource.approach,
        'KeyW',
      ),
    ).toBe(false);
    expect(
      matchesEquipmentRouteArrival(
        baseline,
        { ...ready, authority: { ...ready.authority, acknowledgedInputSequence: 49 } },
        resource.approach,
        'KeyW',
      ),
    ).toBe(false);
    expect(isEquipmentMiningReady({ ...ready, player: [75, 32.6, -0.5] }, resource.target)).toBe(false);
  });

  it('keeps every batch, pickup retreat, and workbench transition on the safe corridor', () => {
    const resources = classicScenario.v2Equipment.resourceStrip;
    const workbench = classicScenario.v2Equipment.workbench;
    const workbenchCorridor = equipmentWorkbenchCorridor(workbench.approach);
    const obstacles = [obstacle(workbench), ...resources.map(obstacle)];
    const groups = [
      resources.filter(({ itemId }) => itemId === 'wood-block'),
      resources.filter(({ itemId }) => itemId === 'stone-block'),
      resources.filter(({ itemId }) => itemId === 'iron-block'),
    ];

    for (const group of groups) {
      expect(
        equipmentRouteNeighborhoodClearsVoxels(workbench.approach, workbenchCorridor, obstacles, playerHalfWidth),
      ).toBe(true);
      let current = workbenchCorridor;
      const cleared = new Set<string>();
      for (const resource of group) {
        expect(equipmentRouteNeighborhoodClearsVoxels(current, resource.approach, obstacles, playerHalfWidth)).toBe(
          true,
        );
        cleared.add(resource.target.join(','));
        const remaining = obstacles.filter(({ position }) => !cleared.has(position.join(',')));
        const pickup = equipmentResourcePickup(resource);
        expect(equipmentRouteNeighborhoodClearsVoxels(resource.approach, pickup, remaining, playerHalfWidth)).toBe(
          true,
        );
        expect(equipmentRouteNeighborhoodClearsVoxels(pickup, resource.approach, remaining, playerHalfWidth)).toBe(
          true,
        );
        current = resource.approach;
      }
      expect(equipmentRouteNeighborhoodClearsVoxels(current, workbenchCorridor, obstacles, playerHalfWidth)).toBe(true);
      expect(
        equipmentRouteNeighborhoodClearsVoxels(workbenchCorridor, workbench.approach, obstacles, playerHalfWidth),
      ).toBe(true);
    }

    const workbenchMiningApproach = equipmentWorkbenchMiningApproach(workbench);
    expect(
      equipmentRouteNeighborhoodClearsVoxels(workbench.approach, workbenchMiningApproach, obstacles, playerHalfWidth),
    ).toBe(true);
    const workbenchSnapshot = routeSnapshot([workbenchMiningApproach[0], 32.6, workbenchMiningApproach[1]], 101, 50);
    expect(isEquipmentMiningReady(workbenchSnapshot, workbench.target)).toBe(true);
    expect(
      equipmentRouteNeighborhoodClearsVoxels(
        workbenchMiningApproach,
        equipmentResourcePickup(workbench),
        resources.map(obstacle),
        playerHalfWidth,
      ),
    ).toBe(true);
  });
});
