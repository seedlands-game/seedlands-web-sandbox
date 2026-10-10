import { describe, expect, it } from 'vitest';
import { bodyConfigFor } from '@seedlands/stdlib/physics/body-registry';
import { stepBody, type BodyState, type PhysicsWorld } from '@seedlands/stdlib/physics';
import { InputCommandBuffer } from '@seedlands/stdlib/runtime/session-protocol';
import { PlayerInputStream } from '../../../src/client/player-input-stream';
import {
  equipmentResourcePickup,
  equipmentRouteNeighborhoodClearsVoxels,
  equipmentRouteSegmentClearsVoxels,
  equipmentWorkbenchCorridor,
  equipmentWorkbenchMiningApproach,
  EQUIPMENT_RESOURCE_WALK_OPTIONS,
  EQUIPMENT_ROUTE_MAX_X_ERROR,
} from './equipment-resource-route';
import { classicScenario, type Point, type RoutePoint } from './scenario';

const DT = 1 / 60;
const LONGEST_BROWSER_16_LEG_METERS = 19.9630739258;
const playerConfig = bodyConfigFor('player');
const playerHalfWidth = Math.max(
  -playerConfig.localAabb.min.x,
  playerConfig.localAabb.max.x,
  -playerConfig.localAabb.min.z,
  playerConfig.localAabb.max.z,
);
const floor = classicScenario.initialState.floor;
const floorBounds = {
  minX: floor.from[0],
  maxX: floor.to[0] + 1,
  minZ: floor.from[2],
  maxZ: floor.to[2] + 1,
};
const floorWorld: PhysicsWorld = {
  querySolids: () => [
    {
      id: 'classic-floor',
      aabb: {
        min: { x: floorBounds.minX, y: floor.from[1], z: floorBounds.minZ },
        max: { x: floorBounds.maxX, y: floor.to[1] + 1, z: floorBounds.maxZ },
      },
    },
  ],
};

type GroundRouteResult = Readonly<{
  elapsedMs: number;
  distance: number;
  grounded: boolean;
  issued: Readonly<{ pressed: number; neutral: number }>;
  consumed: Readonly<{ pressed: number; neutral: number }>;
  pulses: readonly Readonly<{ pressedSequence: number; neutralSequence: number }>[];
}>;

function expectReleasedPulses(result: GroundRouteResult): void {
  expect(result.issued.pressed).toBeGreaterThan(0);
  expect(result.issued.neutral).toBe(result.pulses.length);
  expect(result.consumed.pressed).toBe(result.issued.pressed);
  expect(result.consumed.neutral).toBe(result.pulses.length);
  for (const [index, pulse] of result.pulses.entries()) {
    expect(pulse.neutralSequence).toBeGreaterThan(pulse.pressedSequence);
    if (index > 0) expect(pulse.pressedSequence).toBeGreaterThan(result.pulses[index - 1]!.neutralSequence);
  }
}

function simulateProductionGroundRoute(jump: boolean): GroundRouteResult {
  const stream = new PlayerInputStream('equipment-ground-route', 1);
  const buffer = new InputCommandBuffer('equipment-ground-route', 'player-input');
  let body: BodyState = {
    position: { x: 98.4630739258, y: floor.to[1] + 1, z: -0.5 },
    velocity: { x: 0, y: 0, z: 0 },
  };
  let tick = 0;
  let elapsedMs = 0;
  let grounded = true;
  const issued = { pressed: 0, neutral: 0 };
  const consumedCounts = { pressed: 0, neutral: 0 };
  const issuedKinds = new Map<number, keyof typeof issued>();
  let lastConsumedSequence = -1;
  const pulses: Array<{ pressedSequence: number; neutralSequence: number }> = [];

  while (elapsedMs < 45_000 && 98.4630739258 - body.position.x < LONGEST_BROWSER_16_LEG_METERS) {
    const pulseStartedAt = elapsedMs;
    let releaseIssued = false;
    let pressedSequence: number | null = null;
    let neutralSequence: number | null = null;
    let completed = false;

    while (elapsedMs - pulseStartedAt < 20_000) {
      if (!releaseIssued) {
        const pulseElapsedMs = elapsedMs - pulseStartedAt;
        const kind = pulseElapsedMs < EQUIPMENT_RESOURCE_WALK_OPTIONS.pulseMs ? 'pressed' : 'neutral';
        const command =
          kind === 'neutral'
            ? stream.release(tick, elapsedMs)
            : stream.sample({
                physicsTick: tick,
                issuedAtMs: elapsedMs,
                forward: { x: 1, z: 0 },
                right: { x: 0, z: 1 },
                keys: {
                  forward: false,
                  back: true,
                  left: false,
                  right: false,
                  jump,
                  crouch: false,
                },
              })!;
        issued[kind] += 1;
        issuedKinds.set(command.sequence, kind);
        expect(buffer.push(command)).toBe('accepted');
        if (kind === 'neutral') {
          neutralSequence = command.sequence;
          releaseIssued = true;
        }
      }

      const consumed = buffer.consumeForTick(tick);
      if (consumed.acknowledgedSequence > lastConsumedSequence) {
        const consumedKind = issuedKinds.get(consumed.acknowledgedSequence);
        if (consumedKind) {
          consumedCounts[consumedKind] += 1;
          if (consumedKind === 'pressed') {
            expect(consumed.state.moveX).toBeLessThan(0);
            pressedSequence = consumed.acknowledgedSequence;
          } else {
            expect(consumed.state).toEqual({ moveX: 0, moveZ: 0, verticalIntent: 0, jumpHeld: false });
          }
        }
        lastConsumedSequence = consumed.acknowledgedSequence;
      }
      const stepped = stepBody({
        state: body,
        config: playerConfig,
        input: {
          wish: { x: consumed.state.moveX, z: consumed.state.moveZ },
          jumpPressed: consumed.jumpRequested,
          verticalIntent: consumed.state.verticalIntent,
        },
        world: floorWorld,
        dt: DT,
      });
      body = stepped.state;
      grounded = stepped.grounded;
      tick += 1;
      elapsedMs = tick * DT * 1000;

      if (
        releaseIssued &&
        pressedSequence !== null &&
        neutralSequence !== null &&
        consumed.acknowledgedSequence >= neutralSequence &&
        grounded
      ) {
        pulses.push({ pressedSequence, neutralSequence });
        completed = true;
        break;
      }
    }
    if (!completed) throw new Error('Ground route pulse did not consume its release and settle within 20 seconds.');
  }

  return { elapsedMs, distance: 98.4630739258 - body.position.x, grounded, issued, consumed: consumedCounts, pulses };
}

const routeNeighborhoodInsideFloor = (from: RoutePoint, to: RoutePoint): boolean => {
  const minX = Math.min(from[0], to[0]) - EQUIPMENT_ROUTE_MAX_X_ERROR - playerHalfWidth;
  const maxX = Math.max(from[0], to[0]) + EQUIPMENT_ROUTE_MAX_X_ERROR + playerHalfWidth;
  const minZ = Math.min(from[1], to[1]) - EQUIPMENT_RESOURCE_WALK_OPTIONS.corridorTolerance - playerHalfWidth;
  const maxZ = Math.max(from[1], to[1]) + EQUIPMENT_RESOURCE_WALK_OPTIONS.corridorTolerance + playerHalfWidth;
  return minX >= floorBounds.minX && maxX <= floorBounds.maxX && minZ >= floorBounds.minZ && maxZ <= floorBounds.maxZ;
};

const obstacle = (placement: Readonly<{ target: Point }>): Readonly<{ position: Point }> => ({
  position: placement.target,
});

describe('Classic V2 equipment grounded route', () => {
  it('keeps the longest Browser-16 leg grounded and reachable inside the existing 45 second budget', () => {
    const jumping = simulateProductionGroundRoute(true);
    expectReleasedPulses(jumping);
    expect(jumping.distance).toBeLessThan(LONGEST_BROWSER_16_LEG_METERS);
    expect(jumping.elapsedMs).toBeGreaterThanOrEqual(45_000);

    const configured = simulateProductionGroundRoute(EQUIPMENT_RESOURCE_WALK_OPTIONS.jump);
    expectReleasedPulses(configured);
    expect(configured.distance).toBeGreaterThanOrEqual(LONGEST_BROWSER_16_LEG_METERS);
    expect(configured.elapsedMs).toBeLessThanOrEqual(45_000);
    expect(configured.grounded).toBe(true);
    expect(EQUIPMENT_RESOURCE_WALK_OPTIONS.jump).toBe(false);
  });

  it('keeps every frozen V2 leg on the supported floor and clear of uncleared fixture voxels', () => {
    const resources = classicScenario.v2Equipment.resourceStrip;
    const workbench = classicScenario.v2Equipment.workbench;
    const corridor = equipmentWorkbenchCorridor(workbench.approach);
    const workbenchMining = equipmentWorkbenchMiningApproach(workbench);
    const legs: Array<Readonly<{ from: RoutePoint; to: RoutePoint; obstacles: readonly { position: Point }[] }>> = [];
    const allObstacles = [obstacle(workbench), ...resources.map(obstacle)];
    const v1Handoff = classicScenario.v1Slice.jukebox.approach;

    expect(routeNeighborhoodInsideFloor(v1Handoff, corridor)).toBe(true);
    expect(
      equipmentRouteSegmentClearsVoxels(
        v1Handoff,
        corridor,
        [obstacle(classicScenario.v1Slice.jukebox)],
        playerHalfWidth,
      ),
    ).toBe(true);
    legs.push({ from: corridor, to: workbench.approach, obstacles: resources.map(obstacle) });

    legs.push({ from: workbench.approach, to: corridor, obstacles: allObstacles });
    let placementPosition = corridor;
    for (const resource of resources) {
      legs.push({ from: placementPosition, to: resource.approach, obstacles: allObstacles });
      placementPosition = resource.approach;
    }
    legs.push({ from: placementPosition, to: corridor, obstacles: allObstacles });

    for (const itemId of ['wood-block', 'stone-block', 'iron-block'] as const) {
      const batch = resources.filter((resource) => resource.itemId === itemId);
      let position = corridor;
      const cleared = new Set<string>();
      for (const resource of batch) {
        legs.push({ from: position, to: resource.approach, obstacles: allObstacles });
        cleared.add(resource.target.join(','));
        const remaining = allObstacles.filter(({ position: value }) => !cleared.has(value.join(',')));
        const pickup = equipmentResourcePickup(resource);
        legs.push({ from: resource.approach, to: pickup, obstacles: remaining });
        legs.push({ from: pickup, to: resource.approach, obstacles: remaining });
        position = resource.approach;
      }
      legs.push({ from: position, to: corridor, obstacles: allObstacles });
      legs.push({ from: corridor, to: workbench.approach, obstacles: allObstacles });
    }

    legs.push({ from: corridor, to: workbench.approach, obstacles: allObstacles });
    legs.push({ from: workbench.approach, to: workbenchMining, obstacles: allObstacles });
    legs.push({
      from: workbenchMining,
      to: equipmentResourcePickup(workbench),
      obstacles: resources.map(obstacle),
    });

    expect(legs.length).toBe(52);
    for (const leg of legs) {
      expect(routeNeighborhoodInsideFloor(leg.from, leg.to)).toBe(true);
      expect(equipmentRouteNeighborhoodClearsVoxels(leg.from, leg.to, leg.obstacles, playerHalfWidth)).toBe(true);
    }
  });
});
