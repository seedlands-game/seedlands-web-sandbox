import { bodyConfigFor } from '@seedlands/stdlib/physics/body-registry';

type Point = readonly [number, number, number];

/** 模型以脚底为锚点；返回射线进入躯干体积的距离，受体素遮挡上限约束。 */
export function entityHitDistance(
  feet: Point,
  archetype: string | undefined,
  origin: Point,
  direction: Point,
  maxDistance: number,
): number | null {
  const kind = archetype === 'grazer' || archetype === 'settler' ? archetype : 'night-stalker';
  const box = bodyConfigFor(kind).localAabb;
  const low = [feet[0] + box.min.x, feet[1] + box.min.y, feet[2] + box.min.z];
  const high = [feet[0] + box.max.x, feet[1] + box.max.y, feet[2] + box.max.z];
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
