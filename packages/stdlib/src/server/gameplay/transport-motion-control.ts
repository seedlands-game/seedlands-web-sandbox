/** Movement commands are world-space wishes, independent of the carrier's local axes. */
export function transportControlFromWorldWish(yaw: number, wish: Readonly<{ x: number; z: number }>) {
  if (
    !Number.isFinite(yaw) ||
    !Number.isFinite(wish.x) ||
    !Number.isFinite(wish.z) ||
    Math.abs(wish.x) > 1 ||
    Math.abs(wish.z) > 1
  )
    throw new TypeError('Transport wish is invalid.');
  if (Math.hypot(wish.x, wish.z) <= 1e-9) return { throttle: 0 as const, steering: 0 };
  const forward = wish.x * Math.sin(yaw) + wish.z * Math.cos(yaw);
  const throttle = forward < -1e-9 ? -1 : 1;
  const desired = Math.atan2(wish.x, wish.z) + (throttle === -1 ? Math.PI : 0);
  const error = Math.atan2(Math.sin(desired - yaw), Math.cos(desired - yaw));
  const steering = Math.abs(error) <= 1e-9 ? 0 : Math.max(-1, Math.min(1, error / (Math.PI / 2))) * throttle;
  return { throttle: throttle as -1 | 1, steering };
}
