import type { Page } from '@playwright/test';
import type { HarnessRouteSnapshot } from '../../../src/app/gameplay/game-harness-route-observation';
import type { RoutePoint } from './scenario';
import { reachedRouteTarget, routeInputSettled, routePulseDurationMs } from './route-progress';
import { correctMouseToRoute } from './target-aim';
import { moveMouseBy } from './mouse-input';

export type WalkOptions<Snapshot> = Readonly<{
  key?: 'KeyW' | 'KeyS';
  jump?: boolean;
  tolerance?: number;
  corridorTolerance?: number;
  timeout?: number;
  pulseMs?: number;
  refreshAfterCorrection?: boolean;
  yieldAfterSettledPulse?: (snapshot: Snapshot) => boolean;
}>;

export async function walkWithObservations<Snapshot extends HarnessRouteSnapshot>(
  page: Page,
  target: RoutePoint,
  options: WalkOptions<Snapshot>,
  observe: () => Promise<Snapshot | null>,
  wait: (predicate: (snapshot: Snapshot) => boolean, timeout: number) => Promise<Snapshot>,
): Promise<Snapshot> {
  const { key = 'KeyW', tolerance = 0.65, corridorTolerance = 1.5 } = options;
  const deadline = Date.now() + (options.timeout ?? 45_000);
  let current = await observe();
  if (!current) throw new Error('Classic snapshot is unavailable before route movement.');
  while (!reachedRouteTarget(current.player, target, key, tolerance, corridorTolerance)) {
    if (Date.now() >= deadline) throw new Error('Real input route timed out before ' + target.join(',') + '.');
    const correction = options.refreshAfterCorrection
      ? await correctMouseToRoute({
          wholeTurn: true,
          target,
          direction: key,
          observe: async () => {
            const observed = await observe();
            if (Date.now() >= deadline) throw new Error('Real input route timed out before ' + target.join(',') + '.');
            return observed;
          },
          move: async (dx, dy) => {
            if (Date.now() >= deadline) throw new Error('Real input route timed out before ' + target.join(',') + '.');
            await moveMouseBy(page, dx, dy, { waitForRender: false });
          },
          routeReached: (observed) => reachedRouteTarget(observed.player, target, key, tolerance, corridorTolerance),
        })
      : await correctMouseToRoute({
          wholeTurn: true,
          target,
          direction: key,
          observe,
          move: (dx, dy) => moveMouseBy(page, dx, dy, { waitForRender: false }),
          routeReached: (observed) => reachedRouteTarget(observed.player, target, key, tolerance, corridorTolerance),
        });
    if (!options.refreshAfterCorrection && correction.kind === 'route-reached') return correction.observation;
    if (options.refreshAfterCorrection) {
      if (Date.now() >= deadline) throw new Error('Real input route timed out before ' + target.join(',') + '.');
      if (correction.kind === 'route-reached') return correction.observation;
      if ((current = await observe()) === null)
        throw new Error('Classic snapshot is unavailable after route correction.');
      if (Date.now() >= deadline) throw new Error('Real input route timed out before ' + target.join(',') + '.');
      if (reachedRouteTarget(current.player, target, key, tolerance, corridorTolerance)) return current;
    }
    const segmentStart = current;
    const pulseMs = routePulseDurationMs(current.player, target, options.pulseMs ?? 300);
    const sequenceBeforeInput = current.authority.acknowledgedInputSequence;
    await page.keyboard.down(key);
    if (options.jump) await page.keyboard.down('Space');
    try {
      // This timer bounds the duration of a real input pulse. Readiness is verified below from Authority state.
      await new Promise<void>((resolve) => setTimeout(resolve, pulseMs));
    } finally {
      await page.keyboard.up(key);
      if (options.jump) await page.keyboard.up('Space');
    }
    current = await wait(
      (value) =>
        value.authority.acknowledgedInputSequence > sequenceBeforeInput &&
        value.onGround &&
        !value.colliding &&
        routeInputSettled(value),
      20_000,
    );
    if (current.player[1] < segmentStart.player[1] - 2)
      throw new Error(`Real input route left its supported surface before ${target.join(',')}.`);
    if (options.yieldAfterSettledPulse?.(current)) return current;
  }
  return current;
}
