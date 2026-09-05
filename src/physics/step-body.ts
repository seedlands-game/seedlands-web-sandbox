import {
  COLLISION_EPSILON,
  aabbVolume,
  add,
  bodyWorldAabb,
  dot,
  finiteAabb,
  finiteVec3,
  length,
  overlapDepth,
  overlapVolume,
  scale,
  translateAabb,
  unionAabb,
} from './geometry';
import type {
  BodyConfig,
  BodyState,
  Collider,
  Contact,
  FluidVolume,
  MediumSample,
  PhysicsInput,
  PhysicsStepResult,
  PhysicsWorld,
  Vec3,
  WorldAabb,
} from './types';

const DEFAULT_LAYER = 1;
const DEFAULT_MASK = 0xffffffff;
const MAX_COLLISION_ITERATIONS = 4;
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

type SweepHit = Readonly<{ collider: Collider; normal: Vec3; time: number }>;

const compareCollider = (left: Collider, right: Collider): number => {
  const leftKey = `${left.id ?? ''}:${left.aabb.min.x}:${left.aabb.min.y}:${left.aabb.min.z}`;
  const rightKey = `${right.id ?? ''}:${right.aabb.min.x}:${right.aabb.min.y}:${right.aabb.min.z}`;
  return leftKey.localeCompare(rightKey);
};

const collides = (config: BodyConfig, collider: Collider): boolean =>
  ((config.collisionMask ?? DEFAULT_MASK) & (collider.layer ?? DEFAULT_LAYER)) !== 0 &&
  ((collider.mask ?? DEFAULT_MASK) & (config.collisionLayer ?? DEFAULT_LAYER)) !== 0;

const assertValid = (state: BodyState, config: BodyConfig, input: PhysicsInput, dt: number): void => {
  if (
    !Number.isFinite(dt) ||
    dt <= 0 ||
    !finiteVec3(state.position) ||
    !finiteVec3(state.velocity) ||
    !finiteAabb(config.localAabb)
  )
    throw new RangeError('物理步需要有限的姿态、碰撞箱和正 dt。');
  if (!Number.isFinite(input.wish.x) || !Number.isFinite(input.wish.z))
    throw new RangeError('移动意图必须是有限数值。');
};

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

const contactAt = (position: Vec3, normal: Vec3, collider: Collider): Contact => ({
  colliderId: collider.id,
  normal,
  point: position,
});

const mediumAt = (bounds: WorldAabb, fluids: readonly FluidVolume[] | undefined): MediumSample => {
  if (!fluids?.length) return { submersion: 0, flow: ZERO };
  const bodyVolume = aabbVolume(bounds);
  let covered = 0;
  let flow = ZERO;
  for (const fluid of fluids) {
    const volume = overlapVolume(bounds, fluid.aabb);
    if (volume <= 0) continue;
    covered += volume;
    flow = add(flow, scale(fluid.velocity, volume));
  }
  const submersion = Math.min(1, covered / bodyVolume);
  return submersion > 0 ? { submersion, flow: scale(flow, 1 / covered) } : { submersion: 0, flow: ZERO };
};

const supported = (bounds: WorldAabb, config: BodyConfig, world: PhysicsWorld): boolean => {
  const probe: WorldAabb = {
    min: { x: bounds.min.x, y: bounds.min.y - COLLISION_EPSILON * 4, z: bounds.min.z },
    max: { x: bounds.max.x, y: bounds.min.y + COLLISION_EPSILON * 4, z: bounds.max.z },
  };
  return world.querySolids(probe).some((collider) => {
    if (collider.sensor || !collides(config, collider)) return false;
    const horizontal = overlapDepth(
      { min: { x: bounds.min.x, y: -1, z: bounds.min.z }, max: { x: bounds.max.x, y: 1, z: bounds.max.z } },
      {
        min: { x: collider.aabb.min.x, y: -1, z: collider.aabb.min.z },
        max: { x: collider.aabb.max.x, y: 1, z: collider.aabb.max.z },
      },
    );
    return !!horizontal && Math.abs(bounds.min.y - collider.aabb.max.y) <= COLLISION_EPSILON * 4;
  });
};

const accelerateHorizontal = (
  velocity: Vec3,
  input: PhysicsInput,
  config: BodyConfig,
  grounded: boolean,
  dt: number,
): Vec3 => {
  const wishLength = Math.hypot(input.wish.x, input.wish.z);
  const factor = wishLength > 1 ? 1 / wishLength : 1;
  const maxSpeed = config.maxHorizontalSpeed ?? 4.5;
  const target = { x: input.wish.x * factor * maxSpeed, z: input.wish.z * factor * maxSpeed };
  const acceleration = (grounded ? config.groundAcceleration : config.airAcceleration) ?? (grounded ? 50 : 20);
  const approach = (current: number, desired: number): number => {
    const delta = desired - current;
    return Math.abs(delta) <= acceleration * dt ? desired : current + Math.sign(delta) * acceleration * dt;
  };
  return { x: approach(velocity.x, target.x), y: velocity.y, z: approach(velocity.z, target.z) };
};

const integrateVelocity = (
  state: BodyState,
  config: BodyConfig,
  input: PhysicsInput,
  grounded: boolean,
  medium: MediumSample,
  dt: number,
): Vec3 => {
  let velocity = accelerateHorizontal(state.velocity, input, config, grounded, dt);
  if (grounded && input.jumpPressed) velocity = { ...velocity, y: config.jumpSpeed ?? 6.5 };
  const gravity = config.gravity ?? 18;
  const buoyancy = config.buoyancy ?? 1;
  const drag = Math.max(0, (config.fluidDrag ?? 6) * medium.submersion * dt);
  if (medium.submersion > 0) {
    velocity = add(
      velocity,
      scale(
        { x: medium.flow.x - velocity.x, y: medium.flow.y - velocity.y, z: medium.flow.z - velocity.z },
        Math.min(1, drag),
      ),
    );
    velocity = {
      ...velocity,
      y: velocity.y + input.verticalIntent * (config.swimAcceleration ?? 12) * medium.submersion * dt,
    };
  }
  const maxFall = config.terminalVelocity ?? 24;
  return { ...velocity, y: Math.max(-maxFall, velocity.y - gravity * (1 - buoyancy * medium.submersion) * dt) };
};

const sweepMove = (
  state: BodyState,
  config: BodyConfig,
  world: PhysicsWorld,
  delta: Vec3,
): { state: BodyState; contacts: Contact[] } => {
  let position = state.position;
  let remaining = delta;
  const contacts: Contact[] = [];
  for (
    let iteration = 0;
    iteration < MAX_COLLISION_ITERATIONS && length(remaining) > COLLISION_EPSILON;
    iteration += 1
  ) {
    const current = bodyWorldAabb({ ...state, position }, config);
    const swept = unionAabb(current, translateAabb(current, remaining));
    const hit = world
      .querySolids(swept)
      .filter((collider) => !collider.sensor && collides(config, collider))
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
    contacts.push(contactAt(position, hit.normal, hit.collider));
    const afterImpact = scale(remaining, 1 - hit.time);
    remaining =
      dot(afterImpact, hit.normal) < 0
        ? add(afterImpact, scale(hit.normal, -dot(afterImpact, hit.normal)))
        : afterImpact;
  }
  return { state: { position, velocity: state.velocity }, contacts };
};

const sensorContacts = (state: BodyState, config: BodyConfig, world: PhysicsWorld): Contact[] => {
  const bounds = bodyWorldAabb(state, config);
  return world
    .querySolids(bounds)
    .filter((collider) => collider.sensor && collides(config, collider) && overlapDepth(bounds, collider.aabb))
    .sort(compareCollider)
    .map((collider) => contactAt(state.position, ZERO, collider));
};

export const stepBody = (
  options: Readonly<{ state: BodyState; config: BodyConfig; input: PhysicsInput; world: PhysicsWorld; dt: number }>,
): PhysicsStepResult => {
  const { state, config, input, world, dt } = options;
  assertValid(state, config, input, dt);
  const initialBounds = bodyWorldAabb(state, config);
  const groundedBefore = supported(initialBounds, config, world);
  const initialMedium = mediumAt(initialBounds, world.sampleFluid?.(initialBounds));
  const velocity = integrateVelocity(state, config, input, groundedBefore, initialMedium, dt);
  const moved = sweepMove({ ...state, velocity }, config, world, scale(velocity, dt));
  const grounded =
    moved.contacts.some((contact) => contact.normal.y > 0.5) ||
    supported(bodyWorldAabb(moved.state, config), config, world);
  const finalVelocity = moved.contacts.reduce<Vec3>(
    (current, contact) =>
      dot(current, contact.normal) < 0 ? add(current, scale(contact.normal, -dot(current, contact.normal))) : current,
    velocity,
  );
  const finalState = { ...moved.state, velocity: finalVelocity };
  const bounds = bodyWorldAabb(finalState, config);
  return {
    state: finalState,
    contacts: moved.contacts,
    sensors: sensorContacts(finalState, config, world),
    grounded,
    medium: mediumAt(bounds, world.sampleFluid?.(bounds)),
  };
};
