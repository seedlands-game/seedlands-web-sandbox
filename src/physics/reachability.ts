import { COLLISION_EPSILON, finiteVec3, length, sweepBodyThroughWorld, validateBodyConfig } from './geometry';
import type { BodyConfig, BodyState, PhysicsWorld, Vec3 } from './types';

export type ReachableBodyTarget = Readonly<{ id: string; position: Vec3 }>;

const displacementTo = (state: BodyState, target: Vec3): Vec3 => ({
  x: target.x - state.position.x,
  y: target.y - state.position.y,
  z: target.z - state.position.z,
});

export const isBodyPositionReachable = (
  state: BodyState,
  config: BodyConfig,
  world: PhysicsWorld,
  target: Vec3,
): boolean => {
  if (!finiteVec3(state.position) || !finiteVec3(state.velocity) || !finiteVec3(target) || !validateBodyConfig(config))
    throw new RangeError('身体可达性查询需要有限的姿态、目标和碰撞箱。');
  const path = sweepBodyThroughWorld(state, config, world, displacementTo(state, target));
  return length(displacementTo({ ...state, position: path.position }, target)) <= COLLISION_EPSILON;
};

/**
 * Only the nearest fixed number of candidates may enter swept-AABB queries.
 * Distance breaks first and id breaks exact ties, so input order is irrelevant.
 */
export const selectReachableBodyTarget = (
  options: Readonly<{
    state: BodyState;
    config: BodyConfig;
    world: PhysicsWorld;
    targets: readonly ReachableBodyTarget[];
    maxDistance: number;
    maxCandidates: number;
  }>,
): ReachableBodyTarget | null => {
  const { state, config, world, targets, maxDistance, maxCandidates } = options;
  if (!Number.isFinite(maxDistance) || maxDistance < 0 || !Number.isInteger(maxCandidates) || maxCandidates <= 0)
    throw new RangeError('身体目标查询需要有限距离和正整数候选预算。');
  const candidates = targets
    .map((target) => ({ target, distance: length(displacementTo(state, target.position)) }))
    .filter(({ target, distance }) => finiteVec3(target.position) && distance <= maxDistance + COLLISION_EPSILON)
    .sort(({ target: left, distance: leftDistance }, { target: right, distance: rightDistance }) =>
      leftDistance === rightDistance ? left.id.localeCompare(right.id) : leftDistance - rightDistance,
    )
    .slice(0, maxCandidates);
  return (
    candidates.find(({ target }) => isBodyPositionReachable(state, config, world, target.position))?.target ?? null
  );
};
