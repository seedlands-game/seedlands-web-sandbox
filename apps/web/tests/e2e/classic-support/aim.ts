import type { Page } from '@playwright/test';
import { snapshot, walkTo } from './harness';
import { moveMouseBy } from './mouse-input';
import { matchesVoxelAim, mouseCorrectionToPoint, voxelAimPoint } from './target-aim';
import type { Point } from './scenario';

/** Prepare the canonical first building gesture through the same real input helpers. */
export async function prepareBuildingTargetWithRealMouse(page: Page, target: Point): Promise<void> {
  await walkTo(page, [target[0] - 1.5, target[2] + 0.5], {
    key: 'KeyS',
    tolerance: 0.06,
    corridorTolerance: 0.08,
    pulseMs: 80,
    refreshAfterCorrection: true,
  });
  await aimAtVoxelWithRealMouse(page, [target[0], target[1] - 1, target[2]], target);
}

export type RealMouseAimEvidence = Readonly<{
  target: Point;
  firstObserved: string | null;
  finalObserved: string;
  attempts: number;
  mouseDelta: Readonly<{ x: number; y: number }>;
}>;

/**
 * Reacquires a voxel after a fresh controller is created by save/continue.
 * Every view change is Pointer Lock mouse input; the target card is the visible
 * readback used to decide the next bounded correction.
 */
export async function aimAtVoxelWithRealMouse(
  page: Page,
  target: Point,
  adjacent?: Point,
): Promise<RealMouseAimEvidence> {
  const expected = target.join(',');
  const aimPoint = voxelAimPoint(target, adjacent);
  const history: Array<string | null> = [];
  let firstObserved: string | null | undefined;
  let totalX = 0;
  let totalY = 0;

  for (let attempt = 1; attempt <= 180; attempt += 1) {
    const [observation, playerSnapshot] = await Promise.all([
      page.evaluate(() => ({
        targetCard: document.querySelector('#target-card')?.getAttribute('data-target') ?? null,
        aimed: (window as unknown as import('./harness').ClassicWindow).__seedlandsHarness!.aimedVoxelTarget(),
      })),
      snapshot(page),
    ]);
    const { targetCard: observed, aimed } = observation;
    if (firstObserved === undefined) firstObserved = observed;
    history.push(observed);
    if (history.length > 12) history.shift();
    if (observed === expected && matchesVoxelAim(aimed, target, adjacent))
      return {
        target,
        firstObserved: firstObserved ?? null,
        finalObserved: observed,
        attempts: attempt,
        mouseDelta: { x: totalX, y: totalY },
      };

    const { dx, dy } = playerSnapshot
      ? mouseCorrectionToPoint(playerSnapshot.player, playerSnapshot.viewAngles, aimPoint, { wholeTurn: true })
      : { dx: 0, dy: 12 };
    await moveMouseBy(page, dx, dy, { waitForRender: false });
    totalX += dx;
    totalY += dy;
  }

  throw new Error(`Real mouse input could not reacquire ${expected}; last targets=${JSON.stringify(history)}.`);
}
