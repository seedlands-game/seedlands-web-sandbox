import { bodyConfigFor } from '@seedlands/stdlib/physics';

export type RouteDirection = 'KeyW' | 'KeyS';

export function routeTargetPredicate(
  target: readonly [number, number],
  direction: RouteDirection,
  tolerance: number,
  corridorTolerance: number,
  arrival: 'crossing' | 'point' = 'crossing',
) {
  return (value: Readonly<{ player: readonly [number, number, number] }>) =>
    reachedRouteTarget(value.player, target, direction, tolerance, corridorTolerance, arrival);
}

export function routePulseDurationMs(
  position: readonly [number, number, number],
  target: readonly [number, number],
  maximumMs: number,
): number {
  const distance = Math.hypot(target[0] - position[0], target[1] - position[2]);
  const { groundAcceleration: acceleration, maxHorizontalSpeed: speed } = bodyConfigFor('player');
  if (!acceleration || !speed) throw new Error('Player route requires configured acceleration and speed.');
  // Pulses start at rest and wait for release to settle. Include both acceleration
  // and braking distance so a short segment does not repeatedly overshoot.
  const seconds = distance <= (speed * speed) / acceleration ? Math.sqrt(distance / acceleration) : distance / speed;
  return Math.min(maximumMs, seconds * 1000);
}

/** A movement pulse is complete only after Authority stops and presentation catches up. */
export function routeInputSettled(
  observation: Readonly<{
    player: readonly [number, number, number];
    serverPlayerPosition: readonly [number, number, number];
    serverPlayerVelocity: readonly [number, number, number];
  }>,
): boolean {
  return (
    observation.serverPlayerVelocity.every((value) => Number.isFinite(value) && Math.abs(value) < 1e-6) &&
    observation.player.every(
      (value, axis) => Number.isFinite(value) && Math.abs(value - observation.serverPlayerPosition[axis]!) < 0.05,
    )
  );
}

export function reachedRouteTarget(
  position: readonly [number, number, number],
  target: readonly [number, number],
  direction: RouteDirection,
  tolerance: number,
  corridorTolerance: number,
  arrival: 'crossing' | 'point' = 'crossing',
): boolean {
  const xDelta = position[0] - target[0];
  const zDelta = position[2] - target[1];
  if (Math.hypot(xDelta, zDelta) < tolerance) return true;
  if (arrival === 'point') return false;
  if (Math.abs(zDelta) >= corridorTolerance) return false;
  return direction === 'KeyW' ? xDelta >= 0 : xDelta <= 0;
}
