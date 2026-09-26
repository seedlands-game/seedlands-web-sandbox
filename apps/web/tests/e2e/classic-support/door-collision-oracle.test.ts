import { describe, expect, it } from 'vitest';
import { bodyConfigFor } from '@seedlands/stdlib/physics/body-registry';
import { sweepBodyThroughWorld } from '@seedlands/stdlib/physics/geometry';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { traceVoxelTarget, type VoxelTarget } from '../../../src/client/presentation/voxel-target';
import {
  assessClosedDoorProbe,
  createClosedDoorProbePlan,
  doorEntryAdjacent,
  isOutsideDoorTargetOnEntrySide,
  type ClosedDoorProbeObservation,
} from './door-collision-oracle';
import { matchesVoxelAim, mouseCorrectionToPoint, voxelAimPoint } from './target-aim';
import { reachedRouteTarget } from './route-progress';
import type { Point } from './scenario';

const door = [70, 31, 0] as const;
const browser11DoorPair = [93, 94] as const;
const collision = { min: [0.8125, 0, 0] as const, max: [1, 1, 1] as const };
const playerConfig = bodyConfigFor('player');
const playerHalfWidth = Math.max(
  -playerConfig.localAabb.min.x,
  playerConfig.localAabb.max.x,
  -playerConfig.localAabb.min.z,
  playerConfig.localAabb.max.z,
);
const centeredBefore: ClosedDoorProbeObservation = {
  position: [69.4925, 32.6, 0.5],
  acknowledgedInputSequence: 100,
  physicsTick: 1_000,
  onGround: true,
  colliding: false,
};
const plan = createClosedDoorProbePlan({
  door,
  collision,
  playerPosition: centeredBefore.position,
  playerHalfWidth,
});
const observation = (
  position: readonly [number, number, number],
  acknowledgedInputSequence: number,
  physicsTick: number,
): ClosedDoorProbeObservation => ({
  position,
  acknowledgedInputSequence,
  physicsTick,
  onGround: true,
  colliding: false,
});
const directionForView = ([yaw, pitch]: readonly [number, number]): [number, number, number] => {
  const yawRadians = (yaw * Math.PI) / 180;
  const pitchRadians = (pitch * Math.PI) / 180;
  const horizontal = Math.cos(pitchRadians);
  return [-Math.sin(yawRadians) * horizontal, Math.sin(pitchRadians), -Math.cos(yawRadians) * horizontal];
};
const applyCorrection = (
  view: readonly [number, number],
  correction: Readonly<{ dx: number; dy: number }>,
): readonly [number, number] => [view[0] - correction.dx * 0.13, view[1] - correction.dy * 0.13];
const twoCellDoorTarget = (player: Point, view: readonly [number, number], lower: Point): VoxelTarget | null =>
  traceVoxelTarget(
    [...player],
    directionForView(view),
    (x, y, z) =>
      x === lower[0] && z === lower[2] && y === lower[1]
        ? browser11DoorPair[0]
        : x === lower[0] && z === lower[2] && y === lower[1] + 1
          ? browser11DoorPair[1]
          : Voxel.Air,
    (voxel) => browser11DoorPair.includes(voxel as (typeof browser11DoorPair)[number]),
  );
const convergeDoorAim = (
  player: Point,
  initialView: readonly [number, number],
  lower: Point,
  target: Point,
  adjacent?: Point,
) => {
  let view = initialView;
  for (let attempt = 1; attempt <= 180; attempt += 1) {
    const observed = twoCellDoorTarget(player, view, lower);
    if (matchesVoxelAim(observed, target, adjacent)) return { attempt, observed };
    view = applyCorrection(view, mouseCorrectionToPoint(player, view, voxelAimPoint(target, adjacent)));
  }
  return { attempt: 180, observed: twoCellDoorTarget(player, view, lower) };
};
const playerAtApproach = (
  currentPlan: ReturnType<typeof createClosedDoorProbePlan>,
  normalError = 0,
  lateralError = 0,
): Point => {
  const player: [number, number, number] = [currentPlan.approach[0], 32.6, currentPlan.approach[1]];
  player[currentPlan.normalAxis] += normalError;
  player[currentPlan.lateralAxis] += lateralError;
  return player;
};

describe('Classic closed-door collision oracle', () => {
  it('derives a centered orthogonal route from the actual door collision box', () => {
    expect(plan).toMatchObject({
      normalAxis: 0,
      lateralAxis: 2,
      direction: 1,
    });
    expect(plan.contact).toBeCloseTo(70.4925);
    expect(plan.approach[0]).toBeCloseTo(69.4925);
    expect(plan.approach[1]).toBeCloseTo(0.5);
    expect(plan.routeTarget[0]).toBeCloseTo(71.4925);
    expect(plan.routeTarget[1]).toBeCloseTo(0.5);
    expect(plan.safeLateral[0]).toBeCloseTo(0.320004);
    expect(plan.safeLateral[1]).toBeCloseTo(0.679996);
  });

  it('matches the real physics sweep for closed and open door geometry', () => {
    const state = { position: { x: plan.approach[0], y: 31, z: plan.approach[1] }, velocity: { x: 0, y: 0, z: 0 } };
    const closed = sweepBodyThroughWorld(
      state,
      playerConfig,
      {
        querySolids: () => [
          {
            id: 'closed-door',
            aabb: {
              min: { x: door[0] + collision.min[0], y: door[1], z: door[2] + collision.min[2] },
              max: { x: door[0] + collision.max[0], y: door[1] + 1, z: door[2] + collision.max[2] },
            },
          },
        ],
      },
      { x: 2, y: 0, z: 0 },
    );
    const open = sweepBodyThroughWorld(state, playerConfig, { querySolids: () => [] }, { x: 2, y: 0, z: 0 });

    expect(closed.position.x).toBeCloseTo(plan.contact, 5);
    expect(closed.contacts).toHaveLength(1);
    expect(open.position.x).toBeCloseTo(plan.routeTarget[0]);
    expect(open.contacts).toHaveLength(0);
  });

  it('derives the same orthogonal contract for a Z-normal door', () => {
    const zNormal = createClosedDoorProbePlan({
      door: [3, 31, 4],
      collision: { min: [0, 0, 0], max: [1, 1, 0.1875] },
      playerPosition: [3.5, 32.6, 2],
      playerHalfWidth,
    });

    expect(zNormal).toMatchObject({ normalAxis: 2, lateralAxis: 0, direction: 1 });
    expect(zNormal.contact).toBeCloseTo(3.68);
    expect(zNormal.approach[0]).toBeCloseTo(3.5);
    expect(zNormal.approach[1]).toBeCloseTo(2.68);
    expect(zNormal.routeTarget[0]).toBeCloseTo(3.5);
    expect(zNormal.routeTarget[1]).toBeCloseTo(4.68);
  });

  it('requires leaving the Browser-11 target cell before a strict upper entry face can be observed', () => {
    const upper: Point = [70, 32, 0];
    const adjacent = doorEntryAdjacent(plan, upper);
    const browser11Eye: Point = [70.49249900007506, 32.6, 0.49733905377911297];
    const contact = twoCellDoorTarget(browser11Eye, [-90.12999999999998, -27.44], door);

    expect(contact).toMatchObject({ position: upper, adjacent: null });
    expect(matchesVoxelAim(contact, upper)).toBe(true);
    expect(matchesVoxelAim(contact, upper, adjacent)).toBe(false);

    const result = convergeDoorAim(playerAtApproach(plan), [-90.13, -27.44], door, upper, adjacent);
    expect(result.attempt).toBeLessThanOrEqual(180);
    expect(result.observed).toMatchObject({ position: upper, adjacent });
    expect(isOutsideDoorTargetOnEntrySide(plan, upper, playerAtApproach(plan))).toBe(true);
    expect(isOutsideDoorTargetOnEntrySide(plan, upper, browser11Eye)).toBe(false);
  });

  it.each([
    { collision: { min: [0.8125, 0, 0] as const, max: [1, 1, 1] as const }, player: [67, 32.6, 0.5] as Point },
    { collision: { min: [0.8125, 0, 0] as const, max: [1, 1, 1] as const }, player: [74, 32.6, 0.5] as Point },
    { collision: { min: [0, 0, 0.8125] as const, max: [1, 1, 1] as const }, player: [70.5, 32.6, -3] as Point },
    { collision: { min: [0, 0, 0.8125] as const, max: [1, 1, 1] as const }, player: [70.5, 32.6, 4] as Point },
  ])('derives and reaches the near-side entry face for $player', ({ collision, player }) => {
    const directionalPlan = createClosedDoorProbePlan({ door, collision, playerPosition: player, playerHalfWidth });
    const upper: Point = [door[0], door[1] + 1, door[2]];
    const adjacent = doorEntryAdjacent(directionalPlan, upper);

    for (const [normalError, lateralError] of [
      [-0.04, -0.04],
      [0.04, 0.04],
    ] as const) {
      const approach = playerAtApproach(directionalPlan, normalError, lateralError);
      expect(reachedRouteTarget(approach, directionalPlan.approach, 'KeyS', 0.06, 0.08)).toBe(true);
      const result = convergeDoorAim(approach, [179, 35], door, upper, adjacent);
      expect(result.attempt).toBeLessThanOrEqual(180);
      expect(result.observed).toMatchObject({ position: upper, adjacent });
      expect(isOutsideDoorTargetOnEntrySide(directionalPlan, upper, approach)).toBe(true);
    }
  });

  it('covers the canonical KeyS crossed-target corridor boundary used by the retreat', () => {
    const approach = playerAtApproach(plan, -0.001, 0.079);
    expect(reachedRouteTarget(approach, plan.approach, 'KeyS', 0.06, 0.08)).toBe(true);
    const upper: Point = [door[0], door[1] + 1, door[2]];
    const adjacent = doorEntryAdjacent(plan, upper);
    const result = convergeDoorAim(approach, [-90.13, -27.44], door, upper, adjacent);
    expect(result.attempt).toBeLessThanOrEqual(180);
    expect(result.observed).toMatchObject({ position: upper, adjacent });
  });

  it('keeps strict upper and lower faces observable from the ideal post-traverse point', () => {
    const idealPostTraverse: Point = [door[0] + 1.5, 32.6, door[2] + 0.5];
    const farSidePlan = createClosedDoorProbePlan({
      door,
      collision,
      playerPosition: idealPostTraverse,
      playerHalfWidth,
    });
    const upper: Point = [door[0], door[1] + 1, door[2]];
    const upperCenter = convergeDoorAim(idealPostTraverse, [-90, -20], door, upper);
    expect(upperCenter.attempt).toBeLessThanOrEqual(180);
    expect(upperCenter.observed).toMatchObject({ position: upper, adjacent: [71, 32, 0] });

    const lowerCenter = convergeDoorAim(idealPostTraverse, [-90, -20], door, door);
    expect(lowerCenter.attempt).toBeLessThanOrEqual(180);
    expect(lowerCenter.observed).toMatchObject({ position: door, adjacent: [71, 31, 0] });

    for (const target of [upper, door]) {
      const adjacent = doorEntryAdjacent(farSidePlan, target);
      const result = convergeDoorAim(idealPostTraverse, [-90, -20], door, target, adjacent);
      expect(result.attempt).toBeLessThanOrEqual(180);
      expect(result.observed).toMatchObject({ position: target, adjacent });
    }
  });

  it('accepts fresh orthogonal progress that reaches and remains at the derived contact plane', () => {
    expect(
      assessClosedDoorProbe(plan, centeredBefore, [
        observation([70.2, 32.6, 0.5], 110, 1_010),
        observation([70.4924995, 32.6, 0.5], 120, 1_020),
        observation([70.4924995, 32.6, 0.5], 127, 1_027),
      ]),
    ).toEqual({ status: 'blocked' });
  });

  it('rejects the Browser-09 diagonal trace that slides around the finite door edge', () => {
    const browser09Before = observation([68.46859339486005, 32.6, -0.4489545940748269], 5_549, 12_326);
    const browser09Plan = createClosedDoorProbePlan({
      door,
      collision,
      playerPosition: browser09Before.position,
      playerHalfWidth,
    });

    expect(
      assessClosedDoorProbe(browser09Plan, browser09Before, [
        observation([70.49249948474204, 32.6, 0.7199951193123576], 5_600, 12_380),
        observation([70.49249948474204, 32.6, 1.32061353847437], 5_630, 12_406),
        observation([71.12895363774116, 32.6, 1.5747307585831414], 5_640, 12_417),
      ]),
    ).toEqual({ status: 'invalid', reason: 'outside-safe-corridor' });
  });

  it('rejects a no-collision trace that crosses the contact plane', () => {
    expect(
      assessClosedDoorProbe(plan, centeredBefore, [
        observation([70.3, 32.6, 0.5], 110, 1_010),
        observation([70.7, 32.6, 0.5], 120, 1_020),
      ]),
    ).toEqual({ status: 'invalid', reason: 'crossed-contact-plane' });
  });

  it('rejects fresh acknowledgements without movement', () => {
    expect(assessClosedDoorProbe(plan, centeredBefore, [observation(centeredBefore.position, 110, 1_010)])).toEqual({
      status: 'pending',
      reason: 'insufficient-progress',
    });
  });

  it('rejects a lateral excursion before it can be counted as blocking', () => {
    expect(assessClosedDoorProbe(plan, centeredBefore, [observation([70.4924995, 32.6, 0.7], 120, 1_020)])).toEqual({
      status: 'invalid',
      reason: 'outside-safe-corridor',
    });
  });

  it('rejects contact observations without a fresh acknowledged input', () => {
    expect(
      assessClosedDoorProbe(plan, centeredBefore, [
        observation([70.4924995, 32.6, 0.5], 100, 1_020),
        observation([70.4924995, 32.6, 0.5], 100, 1_027),
      ]),
    ).toEqual({ status: 'pending', reason: 'stale-input' });
  });

  it('rejects an ungrounded or already colliding starting body', () => {
    expect(
      assessClosedDoorProbe(plan, { ...centeredBefore, onGround: false }, [
        observation([70.4924995, 32.6, 0.5], 120, 1_020),
      ]),
    ).toEqual({ status: 'invalid', reason: 'body-not-ready' });
    expect(
      assessClosedDoorProbe(plan, { ...centeredBefore, colliding: true }, [
        observation([70.4924995, 32.6, 0.5], 120, 1_020),
      ]),
    ).toEqual({ status: 'invalid', reason: 'body-not-ready' });
  });
});
