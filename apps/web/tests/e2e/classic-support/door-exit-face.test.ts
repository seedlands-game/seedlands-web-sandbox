import { describe, expect, it } from 'vitest';
import { bodyConfigFor } from '@seedlands/stdlib/physics/body-registry';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { traceVoxelTarget, type VoxelTarget } from '../../../src/client/presentation/voxel-target';
import {
  createClosedDoorProbePlan,
  doorExitAdjacent,
  isOutsideDoorTargetOnExitSide,
  type ClosedDoorProbePlan,
} from './door-collision-oracle';
import { reachedRouteTarget } from './route-progress';
import { matchesVoxelAim, mouseCorrectionToPoint, voxelAimPoint } from './target-aim';
import type { Point } from './scenario';

const lower: Point = [70, 31, 0];
const upper: Point = [70, 32, 0];
const browser13Eye: Point = [71.475830078125, 32.60000228881836, 0.502830982208252];
const browser13View = [-270.17999999999995, -48.37] as const;
const playerBody = bodyConfigFor('player').localAabb;
const playerHalfWidth = Math.max(-playerBody.min.x, playerBody.max.x, -playerBody.min.z, playerBody.max.z);

const directionForView = ([yaw, pitch]: readonly [number, number]): [number, number, number] => {
  const yawRadians = (yaw * Math.PI) / 180;
  const pitchRadians = (pitch * Math.PI) / 180;
  const horizontal = Math.cos(pitchRadians);
  return [-Math.sin(yawRadians) * horizontal, Math.sin(pitchRadians), -Math.cos(yawRadians) * horizontal];
};

const targetDoor = (player: Point, view: readonly [number, number]): VoxelTarget | null =>
  traceVoxelTarget(
    [...player],
    directionForView(view),
    (x, y, z) =>
      x === lower[0] && z === lower[2] && (y === lower[1] || y === upper[1]) ? (y === lower[1] ? 93 : 94) : Voxel.Air,
    (voxel) => voxel === 93 || voxel === 94,
  );

const applyCorrection = (
  view: readonly [number, number],
  correction: Readonly<{ dx: number; dy: number }>,
): readonly [number, number] => [view[0] - correction.dx * 0.13, view[1] - correction.dy * 0.13];

const converge = (player: Point, initialView: readonly [number, number], target: Point, adjacent?: Point) => {
  let view = initialView;
  for (let attempt = 1; attempt <= 180; attempt += 1) {
    const observed = targetDoor(player, view);
    if (matchesVoxelAim(observed, target, adjacent)) return { attempt, observed };
    view = applyCorrection(view, mouseCorrectionToPoint(player, view, voxelAimPoint(target, adjacent)));
  }
  return { attempt: 180, observed: targetDoor(player, view) };
};

const planFor = (collision: Readonly<{ min: Point; max: Point }>, playerPosition: Point): ClosedDoorProbePlan =>
  createClosedDoorProbePlan({ door: lower, collision, playerPosition, playerHalfWidth });

describe('Classic door exit face', () => {
  it('reproduces Browser-13 center occlusion and converges on the strict lower exit face', () => {
    const plan = planFor({ min: [0.8125, 0, 0], max: [1, 1, 1] }, [67, 32.6, 0.5]);
    const center = converge(browser13Eye, browser13View, lower);
    expect(center.attempt).toBe(180);
    expect(center.observed).toMatchObject({ position: upper });

    const adjacent = doorExitAdjacent(plan, lower);
    const strict = converge(browser13Eye, browser13View, lower, adjacent);
    expect(strict.attempt).toBeLessThanOrEqual(180);
    expect(strict.observed).toMatchObject({ position: lower, adjacent });
  });

  it('retains the narrower ideal-eye center result without treating it as the Browser-13 domain', () => {
    const idealEye: Point = [71.5, 32.6, 0.5];
    const result = converge(idealEye, [-90, -20], lower);
    expect(result.attempt).toBeLessThanOrEqual(180);
    expect(result.observed).toMatchObject({ position: lower, adjacent: [71, 31, 0] });
  });

  it.each([
    {
      collision: { min: [0.8125, 0, 0] as Point, max: [1, 1, 1] as Point },
      player: [67, 32.6, 0.5] as Point,
      expected: [71, 31, 0] as Point,
    },
    {
      collision: { min: [0.8125, 0, 0] as Point, max: [1, 1, 1] as Point },
      player: [74, 32.6, 0.5] as Point,
      expected: [69, 31, 0] as Point,
    },
    {
      collision: { min: [0, 0, 0.8125] as Point, max: [1, 1, 1] as Point },
      player: [70.5, 32.6, -3] as Point,
      expected: [70, 31, 1] as Point,
    },
    {
      collision: { min: [0, 0, 0.8125] as Point, max: [1, 1, 1] as Point },
      player: [70.5, 32.6, 4] as Point,
      expected: [70, 31, -1] as Point,
    },
  ])('derives an orthogonal exit adjacent for $player', ({ collision, player, expected }) => {
    const directionalPlan = planFor(collision, player);
    const adjacent = doorExitAdjacent(directionalPlan, lower);
    expect(adjacent).toEqual(expected);
    expect(adjacent.reduce((sum, value, axis) => sum + Math.abs(value - lower[axis]), 0)).toBe(1);

    const exitCenter: [number, number, number] = [adjacent[0] + 0.5, 32.6000001, adjacent[2] + 0.5];
    const boundary: [number, number, number] = [lower[0] + 0.5, 32.5999999, lower[2] + 0.5];
    boundary[directionalPlan.normalAxis] =
      lower[directionalPlan.normalAxis] + (directionalPlan.direction === 1 ? 1 : 0);
    expect(isOutsideDoorTargetOnExitSide(directionalPlan, lower, exitCenter)).toBe(true);
    expect(isOutsideDoorTargetOnExitSide(directionalPlan, lower, boundary)).toBe(false);
  });

  it('requires the complete target voxel exit boundary across the tightened route domain', () => {
    const plan = planFor({ min: [0.8125, 0, 0], max: [1, 1, 1] }, [67, 32.6, 0.5]);
    const route = [lower[0] + 1.5, lower[2] + 0.5] as const;
    const adjacent = doorExitAdjacent(plan, lower);
    for (const position of [
      [71.441, 32.60000228881836, 0.5],
      [71.5, 32.599998474121094, 0.579],
      [71.53, 32.6, 0.421],
    ] as Point[]) {
      expect(reachedRouteTarget(position, route, 'KeyW', 0.06, 0.08)).toBe(true);
      expect(isOutsideDoorTargetOnExitSide(plan, lower, position)).toBe(true);
      const result = converge(position, browser13View, lower, adjacent);
      expect(result.attempt).toBeLessThanOrEqual(180);
      expect(result.observed).toEqual(expect.objectContaining({ position: lower, adjacent }));
    }
    expect(isOutsideDoorTargetOnExitSide(plan, lower, [70.99, 32.6, 0.5])).toBe(false);
    expect(isOutsideDoorTargetOnExitSide(plan, lower, [71, 32.6, 0.5])).toBe(false);
  });

  it('rejects malformed targets instead of fabricating an exit face', () => {
    const plan = planFor({ min: [0.8125, 0, 0], max: [1, 1, 1] }, [67, 32.6, 0.5]);
    expect(() => doorExitAdjacent(plan, [70, 31.5, 0])).toThrow('finite integer');
    expect(isOutsideDoorTargetOnExitSide(plan, lower, [Number.NaN, 32.6, 0.5])).toBe(false);
  });
});
