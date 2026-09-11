import type { Page } from '@playwright/test';
import { moveMouseBy, snapshot } from './harness';
import type { Point } from './scenario';

const MOUSE_SENSITIVITY_DEGREES = 0.13;
const MAX_HORIZONTAL_STEP = 80;

type TargetCardPoint = Readonly<[number, number, number]>;

export type RealMouseAimEvidence = Readonly<{
  target: Point;
  firstObserved: string | null;
  finalObserved: string;
  attempts: number;
  mouseDelta: Readonly<{ x: number; y: number }>;
}>;

const normalizeDegrees = (value: number) => {
  let normalized = value % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized < -180) normalized += 360;
  return normalized;
};

const parseTargetCard = (value: string | null): TargetCardPoint | null => {
  const point = value?.split(',').map(Number);
  return point?.length === 3 && point.every(Number.isFinite) ? ([point[0]!, point[1]!, point[2]!] as const) : null;
};

const voxelCenterYaw = (player: Point, point: TargetCardPoint) =>
  (Math.atan2(-(point[0] + 0.5 - player[0]), -(point[2] + 0.5 - player[2])) * 180) / Math.PI;

const horizontalDistance = (player: Point, point: TargetCardPoint) =>
  Math.hypot(point[0] + 0.5 - player[0], point[2] + 0.5 - player[2]);

/**
 * Reacquires a voxel after a fresh controller is created by save/continue.
 * Every view change is Pointer Lock mouse input; the target card is the visible
 * readback used to decide the next bounded correction.
 */
export async function aimAtVoxelWithRealMouse(page: Page, target: Point): Promise<RealMouseAimEvidence> {
  const expected = target.join(',');
  const history: Array<string | null> = [];
  let firstObserved: string | null | undefined;
  let totalX = 0;
  let totalY = 0;

  for (let attempt = 1; attempt <= 180; attempt += 1) {
    const [observed, playerSnapshot] = await Promise.all([
      page.evaluate(() => document.querySelector('#target-card')?.getAttribute('data-target') ?? null),
      snapshot(page),
    ]);
    if (firstObserved === undefined) firstObserved = observed;
    history.push(observed);
    if (history.length > 12) history.shift();
    if (observed === expected)
      return {
        target,
        firstObserved: firstObserved ?? null,
        finalObserved: observed,
        attempts: attempt,
        mouseDelta: { x: totalX, y: totalY },
      };

    const point = parseTargetCard(observed);
    let dx = 0;
    let dy = 0;
    if (!point || !playerSnapshot) {
      dy = 12;
    } else {
      const targetYaw = voxelCenterYaw(playerSnapshot.player, target);
      const observedYaw = voxelCenterYaw(playerSnapshot.player, point);
      const yawError = normalizeDegrees(targetYaw - observedYaw);
      if (Math.abs(yawError) > 2.5) {
        dx = Math.max(-MAX_HORIZONTAL_STEP, Math.min(MAX_HORIZONTAL_STEP, -yawError / MOUSE_SENSITIVITY_DEGREES));
      } else if (point[1] < target[1]) {
        dy = -6;
      } else if (point[1] > target[1]) {
        dy = 6;
      } else {
        const targetDistance = horizontalDistance(playerSnapshot.player, target);
        const observedDistance = horizontalDistance(playerSnapshot.player, point);
        dy = observedDistance > targetDistance ? 4 : -4;
      }
    }
    await moveMouseBy(page, dx, dy);
    totalX += dx;
    totalY += dy;
  }

  throw new Error(`Real mouse input could not reacquire ${expected}; last targets=${JSON.stringify(history)}.`);
}
