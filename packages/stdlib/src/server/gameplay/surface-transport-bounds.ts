import { rotateInclinedVector, type WorldAabb } from '../../physics';

/** Encloses every yaw in this interval, including extrema between its endpoints. */
export function surfaceYawBounds(local: WorldAabb, fromYaw: number, toYaw: number): WorldAabb {
  if (!Number.isFinite(fromYaw) || !Number.isFinite(toYaw)) throw new TypeError('Surface yaw must be finite.');
  const corners = [local.min.x, local.max.x].flatMap((x) => [local.min.z, local.max.z].map((z) => ({ x, y: 0, z })));
  const low = Math.min(fromYaw, toYaw),
    high = Math.max(fromYaw, toYaw);
  if (high - low >= 2 * Math.PI) {
    const radius = Math.max(...corners.map(({ x, z }) => Math.hypot(x, z)));
    return { min: { x: -radius, y: local.min.y, z: -radius }, max: { x: radius, y: local.max.y, z: radius } };
  }
  const bounds = {
    min: { x: Infinity, y: local.min.y, z: Infinity },
    max: { x: -Infinity, y: local.max.y, z: -Infinity },
  };
  for (const corner of corners) {
    const angles = [fromYaw, toYaw];
    for (const phase of [Math.atan2(corner.z, corner.x), Math.atan2(-corner.x, corner.z)]) {
      const first = phase + Math.ceil((low - phase) / Math.PI) * Math.PI;
      // The interval is shorter than a whole turn; at most three extrema can occur.
      for (let index = 0; index < 3; index++) {
        const angle = first + index * Math.PI;
        if (angle >= low && angle <= high) angles.push(angle);
      }
    }
    for (const yaw of angles) {
      const point = rotateInclinedVector(corner, yaw, 0);
      bounds.min.x = Math.min(bounds.min.x, point.x);
      bounds.max.x = Math.max(bounds.max.x, point.x);
      bounds.min.z = Math.min(bounds.min.z, point.z);
      bounds.max.z = Math.max(bounds.max.z, point.z);
    }
  }
  return bounds;
}
