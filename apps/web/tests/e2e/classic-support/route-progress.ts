export type RouteDirection = 'KeyW' | 'KeyS';

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
): boolean {
  const xDelta = position[0] - target[0];
  const zDelta = position[2] - target[1];
  if (Math.hypot(xDelta, zDelta) < tolerance) return true;
  if (Math.abs(zDelta) >= corridorTolerance) return false;
  return direction === 'KeyW' ? xDelta >= 0 : xDelta <= 0;
}
