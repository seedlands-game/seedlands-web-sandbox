import type { BodyConfig, BodyState, Collider, PhysicsWorld, Vec3, WorldAabb } from './types';

export const COLLISION_EPSILON = 1e-6;

export const add = (left: Vec3, right: Vec3): Vec3 => ({
  x: left.x + right.x,
  y: left.y + right.y,
  z: left.z + right.z,
});

export const scale = (value: Vec3, factor: number): Vec3 => ({
  x: value.x * factor,
  y: value.y * factor,
  z: value.z * factor,
});

export const dot = (left: Vec3, right: Vec3): number => left.x * right.x + left.y * right.y + left.z * right.z;

export const length = (value: Vec3): number => Math.sqrt(dot(value, value));

export const bodyWorldAabb = (state: BodyState, config: BodyConfig): WorldAabb => ({
  min: add(state.position, config.localAabb.min),
  max: add(state.position, config.localAabb.max),
});

export const translateAabb = (aabb: WorldAabb, offset: Vec3): WorldAabb => ({
  min: add(aabb.min, offset),
  max: add(aabb.max, offset),
});

export const unionAabb = (left: WorldAabb, right: WorldAabb): WorldAabb => ({
  min: {
    x: Math.min(left.min.x, right.min.x),
    y: Math.min(left.min.y, right.min.y),
    z: Math.min(left.min.z, right.min.z),
  },
  max: {
    x: Math.max(left.max.x, right.max.x),
    y: Math.max(left.max.y, right.max.y),
    z: Math.max(left.max.z, right.max.z),
  },
});

export const overlapDepth = (left: WorldAabb, right: WorldAabb): Vec3 | null => {
  const depth = {
    x: Math.min(left.max.x, right.max.x) - Math.max(left.min.x, right.min.x),
    y: Math.min(left.max.y, right.max.y) - Math.max(left.min.y, right.min.y),
    z: Math.min(left.max.z, right.max.z) - Math.max(left.min.z, right.min.z),
  };
  return depth.x > COLLISION_EPSILON && depth.y > COLLISION_EPSILON && depth.z > COLLISION_EPSILON ? depth : null;
};

export const overlapVolume = (left: WorldAabb, right: WorldAabb): number => {
  const depth = overlapDepth(left, right);
  return depth ? depth.x * depth.y * depth.z : 0;
};

export const aabbVolume = (aabb: WorldAabb): number =>
  (aabb.max.x - aabb.min.x) * (aabb.max.y - aabb.min.y) * (aabb.max.z - aabb.min.z);

export const finiteVec3 = (value: Vec3): boolean =>
  Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);

export const finiteAabb = (aabb: WorldAabb): boolean =>
  finiteVec3(aabb.min) &&
  finiteVec3(aabb.max) &&
  aabb.min.x < aabb.max.x &&
  aabb.min.y < aabb.max.y &&
  aabb.min.z < aabb.max.z;

const validCollisionBits = (value: number | undefined): boolean =>
  value === undefined || (Number.isInteger(value) && value >= 0 && value <= 0xffffffff);

/**
 * Call this at shape-registry construction and Worker message boundaries.
 * `stepBody` also defends itself because it is a public pure entry point, but
 * trusted registries avoid repeatedly discovering malformed data at runtime.
 */
export const validateBodyConfig = (config: BodyConfig): boolean => {
  const numericValues = [
    config.gravity,
    config.terminalVelocity,
    config.maxHorizontalSpeed,
    config.groundAcceleration,
    config.airAcceleration,
    config.jumpSpeed,
    config.waterSurfaceJumpSpeed,
    config.buoyancy,
    config.fluidDrag,
    config.swimAcceleration,
    config.maxExternalAcceleration,
  ];
  return (
    finiteAabb(config.localAabb) &&
    Math.abs(config.localAabb.min.y) <= COLLISION_EPSILON &&
    numericValues.every((value) => value === undefined || Number.isFinite(value)) &&
    (config.maxExternalAcceleration === undefined || config.maxExternalAcceleration >= 0) &&
    validCollisionBits(config.collisionLayer) &&
    validCollisionBits(config.collisionMask)
  );
};

export const validateCollider = (collider: Collider): boolean =>
  finiteAabb(collider.aabb) && validCollisionBits(collider.layer) && validCollisionBits(collider.mask);

const DEFAULT_LAYER = 1;
const DEFAULT_MASK = 0xffffffff;
const MAX_COLLISION_ITERATIONS = 4;

export type StaticSweepContact = Readonly<{ collider: Collider; normal: Vec3; position: Vec3 }>;

type SweepHit = Readonly<{ collider: Collider; normal: Vec3; time: number }>;

const compareCollider = (left: Collider, right: Collider): number => {
  const leftKey = `${left.id ?? ''}:${left.aabb.min.x}:${left.aabb.min.y}:${left.aabb.min.z}`;
  const rightKey = `${right.id ?? ''}:${right.aabb.min.x}:${right.aabb.min.y}:${right.aabb.min.z}`;
  return leftKey.localeCompare(rightKey);
};

export const colliderMatches = (config: BodyConfig, collider: Collider): boolean =>
  ((config.collisionMask ?? DEFAULT_MASK) & (collider.layer ?? DEFAULT_LAYER)) !== 0 &&
  ((collider.mask ?? DEFAULT_MASK) & (config.collisionLayer ?? DEFAULT_LAYER)) !== 0;

const axisSweep = (
  minimum: number,
  maximum: number,
  obstacleMinimum: number,
  obstacleMaximum: number,
  delta: number,
): [number, number] | null => {
  if (Math.abs(delta) <= COLLISION_EPSILON)
    return maximum > obstacleMinimum + COLLISION_EPSILON && minimum < obstacleMaximum - COLLISION_EPSILON
      ? [-Infinity, Infinity]
      : null;
  if (delta > 0 && minimum >= obstacleMaximum - COLLISION_EPSILON) return null;
  if (delta < 0 && maximum <= obstacleMinimum + COLLISION_EPSILON) return null;
  const first = delta > 0 ? (obstacleMinimum - maximum) / delta : (obstacleMaximum - minimum) / delta;
  const second = delta > 0 ? (obstacleMaximum - minimum) / delta : (obstacleMinimum - maximum) / delta;
  return [Math.min(first, second), Math.max(first, second)];
};

const sweep = (body: WorldAabb, delta: Vec3, collider: Collider): SweepHit | null => {
  const x = axisSweep(body.min.x, body.max.x, collider.aabb.min.x, collider.aabb.max.x, delta.x);
  const y = axisSweep(body.min.y, body.max.y, collider.aabb.min.y, collider.aabb.max.y, delta.y);
  const z = axisSweep(body.min.z, body.max.z, collider.aabb.min.z, collider.aabb.max.z, delta.z);
  if (!x || !y || !z) return null;
  const entry = Math.max(x[0], y[0], z[0]);
  const exit = Math.min(x[1], y[1], z[1]);
  if (entry > exit + COLLISION_EPSILON || exit < -COLLISION_EPSILON || entry > 1 + COLLISION_EPSILON) return null;
  const time = Math.max(0, entry);
  const normal =
    x[0] >= y[0] - COLLISION_EPSILON && x[0] >= z[0] - COLLISION_EPSILON
      ? { x: delta.x > 0 ? -1 : 1, y: 0, z: 0 }
      : y[0] >= z[0] - COLLISION_EPSILON
        ? { x: 0, y: delta.y > 0 ? -1 : 1, z: 0 }
        : { x: 0, y: 0, z: delta.z > 0 ? -1 : 1 };
  return { collider, normal, time };
};

/**
 * Applies the same swept-AABB rule used by normal movement to a bounded
 * translation.  It deliberately does not recover an initial static overlap:
 * recovery is an explicit operation with a separate contract.
 */
export const sweepBodyThroughWorld = (
  state: BodyState,
  config: BodyConfig,
  world: PhysicsWorld,
  delta: Vec3,
): Readonly<{ position: Vec3; contacts: readonly StaticSweepContact[] }> => {
  let position = state.position;
  let remaining = delta;
  const contacts: StaticSweepContact[] = [];
  for (
    let iteration = 0;
    iteration < MAX_COLLISION_ITERATIONS && length(remaining) > COLLISION_EPSILON;
    iteration += 1
  ) {
    const current = bodyWorldAabb({ ...state, position }, config);
    const swept = unionAabb(current, translateAabb(current, remaining));
    const hit = world
      .querySolids(swept)
      .map((collider) => {
        if (!validateCollider(collider)) throw new RangeError('碰撞查询返回了无效碰撞箱。');
        return collider;
      })
      .filter((collider) => !collider.sensor && colliderMatches(config, collider))
      .sort(compareCollider)
      .map((collider) => sweep(current, remaining, collider))
      .filter((candidate): candidate is SweepHit => candidate !== null)
      .sort((left, right) => left.time - right.time || compareCollider(left.collider, right.collider))[0];
    if (!hit) {
      position = add(position, remaining);
      break;
    }
    const retreat = Math.min(hit.time, COLLISION_EPSILON / Math.max(length(remaining), COLLISION_EPSILON));
    position = add(position, scale(remaining, Math.max(0, hit.time - retreat)));
    contacts.push({ collider: hit.collider, normal: hit.normal, position });
    const afterImpact = scale(remaining, 1 - hit.time);
    remaining =
      dot(afterImpact, hit.normal) < 0
        ? add(afterImpact, scale(hit.normal, -dot(afterImpact, hit.normal)))
        : afterImpact;
  }
  return { position, contacts };
};
