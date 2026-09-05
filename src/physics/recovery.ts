import { COLLISION_EPSILON, add, bodyWorldAabb, overlapDepth } from './geometry';
import type { BodyConfig, BodyState, PhysicsWorld, RecoveryResult, SeparationResult, Vec3 } from './types';

const DEFAULT_LAYER = 1;
const DEFAULT_MASK = 0xffffffff;

const collides = (config: BodyConfig, layer: number, mask: number): boolean =>
  ((config.collisionMask ?? DEFAULT_MASK) & layer) !== 0 && (mask & (config.collisionLayer ?? DEFAULT_LAYER)) !== 0;

const candidatesFor = (state: BodyState, config: BodyConfig, world: PhysicsWorld): Vec3[] => {
  const bounds = bodyWorldAabb(state, config);
  const candidates: Vec3[] = [];
  for (const collider of world.querySolids(bounds)) {
    if (collider.sensor || !collides(config, collider.layer ?? DEFAULT_LAYER, collider.mask ?? DEFAULT_MASK)) continue;
    const depth = overlapDepth(bounds, collider.aabb);
    if (!depth) continue;
    candidates.push(
      { x: collider.aabb.min.x - bounds.max.x - COLLISION_EPSILON, y: 0, z: 0 },
      { x: collider.aabb.max.x - bounds.min.x + COLLISION_EPSILON, y: 0, z: 0 },
      { x: 0, y: collider.aabb.min.y - bounds.max.y - COLLISION_EPSILON, z: 0 },
      { x: 0, y: collider.aabb.max.y - bounds.min.y + COLLISION_EPSILON, z: 0 },
      { x: 0, y: 0, z: collider.aabb.min.z - bounds.max.z - COLLISION_EPSILON },
      { x: 0, y: 0, z: collider.aabb.max.z - bounds.min.z + COLLISION_EPSILON },
    );
  }
  return candidates.sort(
    (left, right) =>
      Math.abs(left.x) +
      Math.abs(left.y) +
      Math.abs(left.z) -
      (Math.abs(right.x) + Math.abs(right.y) + Math.abs(right.z)),
  );
};

export const recoverBody = (
  options: Readonly<{ state: BodyState; config: BodyConfig; world: PhysicsWorld; maxDistance: number }>,
): RecoveryResult => {
  const { config, world, maxDistance } = options;
  if (!Number.isFinite(maxDistance) || maxDistance < 0) throw new RangeError('恢复距离必须是有限的非负数。');
  let state = options.state;
  let distance = 0;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const candidates = candidatesFor(state, config, world);
    if (!candidates.length) return { state, recovered: distance > 0, distance };
    const candidate = candidates[0]!;
    const increment = Math.abs(candidate.x) + Math.abs(candidate.y) + Math.abs(candidate.z);
    if (distance + increment > maxDistance) return { state: options.state, recovered: false, distance: 0 };
    state = { ...state, position: add(state.position, candidate) };
    distance += increment;
  }
  return candidatesFor(state, config, world).length
    ? { state: options.state, recovered: false, distance: 0 }
    : { state, recovered: true, distance };
};

export const separateBodies = (
  options: Readonly<{
    left: BodyState;
    leftConfig: BodyConfig;
    right: BodyState;
    rightConfig: BodyConfig;
    maxDistance: number;
  }>,
): SeparationResult => {
  const { left, leftConfig, right, rightConfig, maxDistance } = options;
  if (!Number.isFinite(maxDistance) || maxDistance < 0) throw new RangeError('推离距离必须是有限的非负数。');
  if (
    leftConfig.pushable === false ||
    rightConfig.pushable === false ||
    !collides(leftConfig, rightConfig.collisionLayer ?? DEFAULT_LAYER, rightConfig.collisionMask ?? DEFAULT_MASK) ||
    !collides(rightConfig, leftConfig.collisionLayer ?? DEFAULT_LAYER, leftConfig.collisionMask ?? DEFAULT_MASK)
  )
    return { left, right, separated: false };
  const leftBounds = bodyWorldAabb(left, leftConfig);
  const rightBounds = bodyWorldAabb(right, rightConfig);
  const depth = overlapDepth(leftBounds, rightBounds);
  if (!depth) return { left, right, separated: false };
  const axis = depth.x <= depth.z ? 'x' : 'z';
  const direction = left.position[axis] <= right.position[axis] ? -1 : 1;
  const required = Math.min(maxDistance, (depth[axis] + COLLISION_EPSILON) / 2);
  if (required <= 0) return { left, right, separated: false };
  const shift: Vec3 = axis === 'x' ? { x: direction * required, y: 0, z: 0 } : { x: 0, y: 0, z: direction * required };
  return {
    left: { ...left, position: add(left.position, shift) },
    right: { ...right, position: add(right.position, { x: -shift.x, y: 0, z: -shift.z }) },
    separated: true,
  };
};
