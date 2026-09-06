type Position = readonly [number, number, number];

export function movementPose(previous: Position | undefined, current: Position, time: number) {
  const dx = previous ? current[0] - previous[0] : 0;
  const dz = previous ? current[2] - previous[2] : 0;
  if (Math.hypot(dx, dz) < 0.0001) return { yaw: null, stride: 0, bob: 0 };
  const yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI;
  return { yaw: yaw === 0 ? 0 : yaw, stride: Math.sin(time * 9) * 22, bob: Math.abs(Math.sin(time * 9)) * 0.035 };
}

export function damageFlash(time: number, until: number) {
  return Math.max(0, Math.min(1, (until - time) / 0.25));
}
