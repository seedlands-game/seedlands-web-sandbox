import {
  COLLISION_EPSILON,
  add,
  bodyWorldAabb,
  colliderMatches,
  finiteVec3,
  length,
  overlapDepth,
  sweepBodyThroughWorld,
  unionAabb,
  validateBodyConfig,
  validateCollider,
} from './geometry';
import type {
  BodyConfig,
  BodyState,
  Collider,
  PhysicsWorld,
  RecoveryResult,
  SeparationResult,
  Vec3,
  WorldAabb,
} from './types';

const MAX_RECOVERY_CANDIDATES = 8192;

const compareCollider = (left: Collider, right: Collider): number => {
  const leftKey = `${left.id ?? ''}:${left.aabb.min.x}:${left.aabb.min.y}:${left.aabb.min.z}`;
  const rightKey = `${right.id ?? ''}:${right.aabb.min.x}:${right.aabb.min.y}:${right.aabb.min.z}`;
  return leftKey.localeCompare(rightKey);
};

const assertBody = (state: BodyState, config: BodyConfig): void => {
  if (!finiteVec3(state.position) || !finiteVec3(state.velocity) || !validateBodyConfig(config))
    throw new RangeError('物理姿态和碰撞箱必须有限，且位置原点必须位于碰撞箱底面。');
};

const relevantColliders = (bounds: WorldAabb, config: BodyConfig, world: PhysicsWorld): Collider[] =>
  world
    .querySolids(bounds)
    .map((collider) => {
      if (!validateCollider(collider)) throw new RangeError('碰撞查询返回了无效碰撞箱。');
      return collider;
    })
    .filter((collider) => !collider.sensor && colliderMatches(config, collider))
    .sort(compareCollider);

const overlapsStatic = (state: BodyState, config: BodyConfig, world: PhysicsWorld): boolean => {
  const bounds = bodyWorldAabb(state, config);
  return relevantColliders(bounds, config, world).some((collider) => overlapDepth(bounds, collider.aabb));
};

const expandedBounds = (bounds: WorldAabb, maxDistance: number): WorldAabb =>
  unionAabb(
    {
      min: { x: bounds.min.x - maxDistance, y: bounds.min.y - maxDistance, z: bounds.min.z - maxDistance },
      max: bounds.max,
    },
    {
      min: bounds.min,
      max: { x: bounds.max.x + maxDistance, y: bounds.max.y + maxDistance, z: bounds.max.z + maxDistance },
    },
  );

const coordinatesFor = (
  bounds: WorldAabb,
  colliders: readonly Collider[],
  maxDistance: number,
): Readonly<{ x: readonly number[]; y: readonly number[]; z: readonly number[] }> => {
  const values = { x: new Set<number>([0]), y: new Set<number>([0]), z: new Set<number>([0]) };
  for (const collider of colliders) {
    values.x.add(collider.aabb.min.x - bounds.max.x - COLLISION_EPSILON);
    values.x.add(collider.aabb.max.x - bounds.min.x + COLLISION_EPSILON);
    values.y.add(collider.aabb.min.y - bounds.max.y - COLLISION_EPSILON);
    values.y.add(collider.aabb.max.y - bounds.min.y + COLLISION_EPSILON);
    values.z.add(collider.aabb.min.z - bounds.max.z - COLLISION_EPSILON);
    values.z.add(collider.aabb.max.z - bounds.min.z + COLLISION_EPSILON);
  }
  const allowed = (valuesForAxis: Set<number>): number[] =>
    [...valuesForAxis]
      .filter((value) => Math.abs(value) <= maxDistance + COLLISION_EPSILON)
      .sort((left, right) => left - right);
  return { x: allowed(values.x), y: allowed(values.y), z: allowed(values.z) };
};

const compareDisplacement = (left: Vec3, right: Vec3): number =>
  length(left) - length(right) || left.x - right.x || left.y - right.y || left.z - right.z;

/**
 * Explicitly repairs an externally-created overlap. Candidates are complete
 * face planes from every nearby static box and are checked against the full
 * static set before state is changed. Normal fixed stepping never calls it.
 */
export const recoverBody = (
  options: Readonly<{ state: BodyState; config: BodyConfig; world: PhysicsWorld; maxDistance: number }>,
): RecoveryResult => {
  const { state, config, world, maxDistance } = options;
  assertBody(state, config);
  if (!Number.isFinite(maxDistance) || maxDistance < 0) throw new RangeError('恢复距离必须是有限的非负数。');
  const bounds = bodyWorldAabb(state, config);
  const colliders = relevantColliders(expandedBounds(bounds, maxDistance), config, world);
  if (!colliders.some((collider) => overlapDepth(bounds, collider.aabb)))
    return { state, recovered: false, distance: 0 };
  const coordinates = coordinatesFor(bounds, colliders, maxDistance);
  if (
    coordinates.x.length > Math.floor(MAX_RECOVERY_CANDIDATES / Math.max(1, coordinates.y.length)) ||
    coordinates.x.length * coordinates.y.length >
      Math.floor(MAX_RECOVERY_CANDIDATES / Math.max(1, coordinates.z.length))
  )
    // Exhausting the declared search budget is a normal bounded failure. Invalid
    // inputs and malformed colliders still throw before reaching this branch.
    return { state, recovered: false, distance: 0 };
  const candidates: Vec3[] = [];
  for (const x of coordinates.x)
    for (const y of coordinates.y)
      for (const z of coordinates.z) {
        const displacement = { x, y, z };
        if (length(displacement) <= maxDistance + COLLISION_EPSILON) candidates.push(displacement);
      }
  for (const displacement of candidates.sort(compareDisplacement)) {
    if (length(displacement) <= COLLISION_EPSILON) continue;
    const candidate = { ...state, position: add(state.position, displacement) };
    if (!overlapsStatic(candidate, config, world))
      return { state: candidate, recovered: true, distance: length(displacement) };
  }
  return { state, recovered: false, distance: 0 };
};

const pushPlans = (depth: number, maxDistance: number): readonly [number, number][] => {
  const total = Math.min(depth, maxDistance * 2);
  const balancedLeft = Math.min(maxDistance, total / 2);
  const balancedRight = Math.min(maxDistance, total - balancedLeft);
  const leftFirst = Math.min(maxDistance, total);
  const rightFirst = Math.min(maxDistance, total);
  return [
    [balancedLeft, balancedRight],
    [leftFirst, Math.min(maxDistance, total - leftFirst)],
    [Math.min(maxDistance, total - rightFirst), rightFirst],
  ];
};

const moveOnAxis = (axis: 'x' | 'z', direction: number, distance: number): Vec3 =>
  axis === 'x' ? { x: direction * distance, y: 0, z: 0 } : { x: 0, y: 0, z: direction * distance };

/**
 * Applies a bounded actor push without ever writing a position through a
 * static collider. Each candidate pair is clamped by the same swept-AABB
 * query as normal motion. `separated` is true only for a fully clear pair.
 */
export const separateBodies = (
  options: Readonly<{
    left: BodyState;
    leftConfig: BodyConfig;
    right: BodyState;
    rightConfig: BodyConfig;
    world: PhysicsWorld;
    maxDistance: number;
  }>,
): SeparationResult => {
  const { left, leftConfig, right, rightConfig, world, maxDistance } = options;
  assertBody(left, leftConfig);
  assertBody(right, rightConfig);
  if (!Number.isFinite(maxDistance) || maxDistance < 0) throw new RangeError('推离距离必须是有限的非负数。');
  const rightCollider: Collider = {
    aabb: bodyWorldAabb(right, rightConfig),
    layer: rightConfig.collisionLayer,
    mask: rightConfig.collisionMask,
  };
  const leftCollider: Collider = {
    aabb: bodyWorldAabb(left, leftConfig),
    layer: leftConfig.collisionLayer,
    mask: leftConfig.collisionMask,
  };
  const leftBounds = bodyWorldAabb(left, leftConfig);
  const rightBounds = bodyWorldAabb(right, rightConfig);
  const depth = overlapDepth(leftBounds, rightBounds);
  if (!depth) return { left, right, separated: true };
  if (
    leftConfig.pushable === false ||
    rightConfig.pushable === false ||
    !colliderMatches(leftConfig, rightCollider) ||
    !colliderMatches(rightConfig, leftCollider)
  )
    return { left, right, separated: false };
  if (maxDistance <= COLLISION_EPSILON) return { left, right, separated: false };
  const axis = depth.x <= depth.z ? 'x' : 'z';
  const leftDirection = left.position[axis] <= right.position[axis] ? -1 : 1;
  let best: SeparationResult = { left, right, separated: false };
  let bestDepth = depth[axis];
  for (const [leftDistance, rightDistance] of pushPlans(depth[axis], maxDistance)) {
    const movedLeft = sweepBodyThroughWorld(left, leftConfig, world, moveOnAxis(axis, leftDirection, leftDistance));
    const movedRight = sweepBodyThroughWorld(
      right,
      rightConfig,
      world,
      moveOnAxis(axis, -leftDirection, rightDistance),
    );
    const nextLeft = { ...left, position: movedLeft.position };
    const nextRight = { ...right, position: movedRight.position };
    if (overlapsStatic(nextLeft, leftConfig, world) || overlapsStatic(nextRight, rightConfig, world)) continue;
    const remaining = overlapDepth(bodyWorldAabb(nextLeft, leftConfig), bodyWorldAabb(nextRight, rightConfig));
    if (!remaining) return { left: nextLeft, right: nextRight, separated: true };
    if (remaining[axis] < bestDepth - COLLISION_EPSILON) {
      best = { left: nextLeft, right: nextRight, separated: false };
      bestDepth = remaining[axis];
    }
  }
  return best;
};
