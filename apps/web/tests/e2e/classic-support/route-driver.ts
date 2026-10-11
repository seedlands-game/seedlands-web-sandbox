import type { Page } from '@playwright/test';
import type { ClassicSnapshot } from './harness-snapshot';
import type { RoutePoint } from './scenario';
import type { RoutePulseDiagnostics } from './route-pulse-diagnostics';
import { snapshot, waitForSnapshot } from './snapshot-read';
import { routeTargetPredicate, routePulseSettledPredicate, routePulseDurationMs } from './route-progress';
import { correctMouseToRoute } from './target-aim';
import { moveMouseBy } from './mouse-input';
import { sendNativeMovementPulse } from './native-movement-pulse';
import { nativeMovementPage } from './native-keyboard-port';
import { RouteCrowdRecovery } from './route-crowd-recovery';

export async function walkTo(
  page: Page,
  target: RoutePoint,
  options: Readonly<{
    key?: 'KeyW' | 'KeyS';
    jump?: boolean;
    tolerance?: number;
    corridorTolerance?: number;
    arrival?: 'crossing' | 'point';
    timeout?: number;
    pulseMs?: number | ((snapshot: ClassicSnapshot) => number);
    refreshAfterCorrection?: boolean;
    yieldAfterSettledPulse?: (snapshot: ClassicSnapshot) => boolean;
    diagnostics?: RoutePulseDiagnostics;
    recoverCrowd?: boolean;
  }> = {},
): Promise<ClassicSnapshot> {
  const { key = 'KeyW', tolerance = 0.65, corridorTolerance = 1.5 } = options;
  const reached = routeTargetPredicate(target, key, tolerance, corridorTolerance, options.arrival);
  const recovery = options.recoverCrowd ? new RouteCrowdRecovery(target) : undefined;
  const deadline = Date.now() + (options.timeout ?? 45_000);
  let observe = () => snapshot(page);
  let current = await observe();
  if (!current) throw new Error('Classic snapshot is unavailable before route movement.');
  while (!reached(current)) {
    if (Date.now() >= deadline) throw new Error('Real input route timed out before ' + target.join(',') + '.');
    options.diagnostics?.begin(current);
    const aimTarget = recovery?.aimTarget(current.serverPlayerPosition) ?? target;
    const correction = options.refreshAfterCorrection
      ? await correctMouseToRoute({
          wholeTurn: true,
          target: aimTarget,
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
          routeReached: reached,
        })
      : await correctMouseToRoute({
          wholeTurn: true,
          target: aimTarget,
          direction: key,
          observe,
          move: (dx, dy) => moveMouseBy(page, dx, dy, { waitForRender: false }),
          routeReached: reached,
        });
    if (!options.refreshAfterCorrection && correction.kind === 'route-reached') return correction.observation;
    if (options.refreshAfterCorrection) {
      if (Date.now() >= deadline) throw new Error('Real input route timed out before ' + target.join(',') + '.');
      if (correction.kind === 'route-reached') return correction.observation;
      if ((current = await observe()) === null)
        throw new Error('Classic snapshot is unavailable after route correction.');
      if (Date.now() >= deadline) throw new Error('Real input route timed out before ' + target.join(',') + '.');
      if (reached(current)) return current;
    }
    const segmentStart = current;
    const maximumPulseMs = typeof options.pulseMs === 'function' ? options.pulseMs(current) : (options.pulseMs ?? 300);
    const pulseMs = routePulseDurationMs(current.player, target, maximumPulseMs);
    const settledPulse = routePulseSettledPredicate(current);
    const nativePage = await nativeMovementPage(page);
    observe = nativePage.snapshot;
    if (options.refreshAfterCorrection && Date.now() >= deadline)
      throw new Error('Real input route timed out before ' + target.join(',') + '.');
    options.diagnostics?.beforeInput(current, pulseMs, options.jump ? `${key}+Space` : key);
    try {
      await sendNativeMovementPulse(nativePage, key, pulseMs, options.jump);
      options.diagnostics?.inputFinished('returned');
    } catch (error) {
      options.diagnostics?.inputFinished('threw');
      throw error;
    }
    current = await waitForSnapshot(
      page,
      (value) => {
        const settled = settledPulse(value);
        options.diagnostics?.observe(value, settled);
        return settled;
      },
      20_000,
      observe,
    );
    if (current.player[1] < segmentStart.player[1] - 2)
      throw new Error(`Real input route left its supported surface before ${target.join(',')}.`);
    recovery?.observe(segmentStart.serverPlayerPosition, current.serverPlayerPosition, pulseMs);
    if (options.yieldAfterSettledPulse?.(current)) return current;
  }
  return current;
}
