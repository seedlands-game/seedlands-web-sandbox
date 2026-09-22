export type RouteDirection = 'KeyW' | 'KeyS';

export function reachedRouteTarget(
  position: readonly [number, number, number],
  target: readonly [number, number],
  direction: RouteDirection,
  tolerance: number,
): boolean {
  const xDelta = position[0] - target[0];
  const zDelta = position[2] - target[1];
  if (Math.hypot(xDelta, zDelta) < tolerance) return true;
  if (Math.abs(zDelta) >= tolerance) return false;
  return direction === 'KeyW' ? xDelta >= 0 : xDelta <= 0;
}
