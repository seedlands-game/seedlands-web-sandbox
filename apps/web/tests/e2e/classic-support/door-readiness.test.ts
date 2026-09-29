import { describe, expect, it } from 'vitest';
import {
  createClosedDoorProbePlan,
  isOutsideDoorTargetOnEntrySide,
  isOutsideDoorTargetOnExitSide,
  matchesDoorRouteReadinessSnapshot,
  type ClosedDoorProbePlan,
} from './door-collision-oracle';
import type { Point } from './scenario';

type Snapshot = Readonly<{
  player: Point;
  serverPlayerPosition: Point;
  onGround: boolean;
  colliding: boolean;
  authority: Readonly<{ physicsTick: number; acknowledgedInputSequence: number }>;
}>;

const lower: Point = [70, 31, 0];
const plan: ClosedDoorProbePlan = createClosedDoorProbePlan({
  door: lower,
  collision: { min: [0.8125, 0, 0], max: [1, 1, 1] },
  playerPosition: [67, 32.6, 0.5],
  playerHalfWidth: 0.32,
});
const snapshot = (
  playerX: number,
  serverX: number,
  physicsTick: number,
  acknowledgedInputSequence: number,
  ready = true,
): Snapshot => ({
  player: [playerX, 32.6, 0.5],
  serverPlayerPosition: [serverX, 32.600001, 0.5],
  onGround: ready,
  colliding: !ready,
  authority: { physicsTick, acknowledgedInputSequence },
});

describe('Classic door route readiness snapshot', () => {
  it.each([
    { side: 'entry' as const, target: [70, 32, 0] as Point, outside: 69.49, inside: 70.01 },
    { side: 'exit' as const, target: lower, outside: 71.5, inside: 70.99 },
  ])(
    'matches one fresh ready $side snapshot with both projections beyond the full voxel',
    ({ side, target, outside, inside }) => {
      const baseline = snapshot(outside, outside, 100, 50);
      const samples = [
        snapshot(outside, outside, 100, 50),
        snapshot(outside, outside, 101, 50, false),
        snapshot(outside, inside, 102, 50),
        snapshot(inside, outside, 103, 50),
        snapshot(outside, outside, 104, 49),
        snapshot(outside + (side === 'exit' ? 0.10638427734375 : -0.1), outside, 105, 50),
      ];

      const matches = samples.map((current) =>
        matchesDoorRouteReadinessSnapshot(plan, target, side, baseline, current),
      );
      const matched = samples.find((current) =>
        matchesDoorRouteReadinessSnapshot(plan, target, side, baseline, current),
      );

      expect(matches).toEqual([false, false, false, false, false, true]);
      expect(matched).toBe(samples[5]);
      expect(matched).toEqual(samples[5]);
    },
  );

  it('uses the same complete-voxel boundary contract for entry and exit', () => {
    expect(isOutsideDoorTargetOnEntrySide(plan, [70, 32, 0], [69.49, 32.6, 0.5])).toBe(true);
    expect(isOutsideDoorTargetOnExitSide(plan, lower, [71.5, 32.6, 0.5])).toBe(true);
  });
});
