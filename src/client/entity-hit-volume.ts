type Point = readonly [number, number, number];

/** 模型以脚底为锚点；返回射线进入躯干体积的距离，受体素遮挡上限约束。 */
export function entityHitDistance(
  feet: Point,
  archetype: string | undefined,
  origin: Point,
  direction: Point,
  maxDistance: number,
): number | null {
  const halfWidth = archetype === 'grazer' ? 0.75 : 0.65;
  const height = archetype === 'grazer' ? 1.9 : archetype === 'settler' ? 2.35 : 2.1;
  const low = [feet[0] - halfWidth, feet[1], feet[2] - halfWidth];
  const high = [feet[0] + halfWidth, feet[1] + height, feet[2] + halfWidth];
  let near = 0;
  let far = maxDistance;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(direction[axis]) < 1e-8) {
      if (origin[axis] < low[axis] || origin[axis] > high[axis]) return null;
      continue;
    }
    const a = (low[axis] - origin[axis]) / direction[axis];
    const b = (high[axis] - origin[axis]) / direction[axis];
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
    if (near > far) return null;
  }
  return far > 0 ? near : null;
}
