import {
  COLLISION_EPSILON,
  aabbVolume,
  add,
  bodyWorldAabb,
  dot,
  finiteAabb,
  finiteVec3,
  overlapDepth,
  overlapVolume,
  scale,
  colliderMatches,
  sweepBodyThroughWorld,
  validateBodyConfig,
  validateCollider,
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

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

const assertValid = (state: BodyState, config: BodyConfig, input: PhysicsInput, dt: number): void => {
  if (
    !Number.isFinite(dt) ||
    dt <= 0 ||
    !finiteVec3(state.position) ||
    !finiteVec3(state.velocity) ||
    !validateBodyConfig(config)
  )
    throw new RangeError('物理步需要有限的姿态、碰撞箱和正 dt。');
  if (!Number.isFinite(input.wish.x) || !Number.isFinite(input.wish.z) || ![-1, 0, 1].includes(input.verticalIntent))
    throw new RangeError('移动意图必须是有限数值。');
};

const contactAt = (position: Vec3, config: BodyConfig, normal: Vec3, collider: Collider): Contact => {
  if (normal.x === 0 && normal.y === 0 && normal.z === 0) return { colliderId: collider.id, normal, point: position };
  const bounds = bodyWorldAabb({ position, velocity: ZERO }, config);
  const middle = (firstMin: number, firstMax: number, secondMin: number, secondMax: number): number =>
    (Math.max(firstMin, secondMin) + Math.min(firstMax, secondMax)) / 2;
  const point =
    normal.x !== 0
      ? {
          x: normal.x < 0 ? bounds.max.x : bounds.min.x,
          y: middle(bounds.min.y, bounds.max.y, collider.aabb.min.y, collider.aabb.max.y),
          z: middle(bounds.min.z, bounds.max.z, collider.aabb.min.z, collider.aabb.max.z),
        }
      : normal.y !== 0
        ? {
            x: middle(bounds.min.x, bounds.max.x, collider.aabb.min.x, collider.aabb.max.x),
            y: normal.y < 0 ? bounds.max.y : bounds.min.y,
            z: middle(bounds.min.z, bounds.max.z, collider.aabb.min.z, collider.aabb.max.z),
          }
        : {
            x: middle(bounds.min.x, bounds.max.x, collider.aabb.min.x, collider.aabb.max.x),
            y: middle(bounds.min.y, bounds.max.y, collider.aabb.min.y, collider.aabb.max.y),
            z: normal.z < 0 ? bounds.max.z : bounds.min.z,
          };
  return { colliderId: collider.id, normal, point };
};

const mediumAt = (bounds: WorldAabb, fluids: readonly FluidVolume[] | undefined): MediumSample => {
  if (!fluids?.length) return { submersion: 0, flow: ZERO };
  const bodyVolume = aabbVolume(bounds);
  let covered = 0;
  let flow = ZERO;
  for (const fluid of fluids) {
    if (
      !finiteAabb(fluid.aabb) ||
      !finiteVec3(fluid.velocity) ||
      (fluid.surfaceY !== undefined &&
        (!Number.isFinite(fluid.surfaceY) ||
          fluid.surfaceY < fluid.aabb.min.y - COLLISION_EPSILON ||
          fluid.surfaceY > fluid.aabb.max.y + COLLISION_EPSILON))
    )
      throw new RangeError('流体采样必须包含有限的碰撞箱和流速。');
    const volume = overlapVolume(bounds, fluid.aabb);
    if (volume <= 0) continue;
    covered += volume;
    flow = add(flow, scale(fluid.velocity, volume));
  }
  const submersion = Math.min(1, covered / bodyVolume);
  return submersion > 0 ? { submersion, flow: scale(flow, 1 / covered) } : { submersion: 0, flow: ZERO };
};

const reachesFluidSurface = (bounds: WorldAabb, fluids: readonly FluidVolume[] | undefined): boolean =>
  !!fluids?.some(
    (fluid) =>
      fluid.surfaceY !== undefined &&
      bounds.max.y >= fluid.surfaceY - COLLISION_EPSILON &&
      bounds.min.x < fluid.aabb.max.x - COLLISION_EPSILON &&
      bounds.max.x > fluid.aabb.min.x + COLLISION_EPSILON &&
      bounds.min.z < fluid.aabb.max.z - COLLISION_EPSILON &&
      bounds.max.z > fluid.aabb.min.z + COLLISION_EPSILON,
  );

const supported = (bounds: WorldAabb, config: BodyConfig, world: PhysicsWorld): boolean => {
  const probe: WorldAabb = {
    min: { x: bounds.min.x, y: bounds.min.y - COLLISION_EPSILON * 4, z: bounds.min.z },
    max: { x: bounds.max.x, y: bounds.min.y + COLLISION_EPSILON * 4, z: bounds.max.z },
  };
  return world.querySolids(probe).some((collider) => {
    if (!validateCollider(collider)) throw new RangeError('碰撞查询返回了无效碰撞箱。');
    if (collider.sensor || !colliderMatches(config, collider)) return false;
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
  surfaceJump: boolean,
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
  velocity = { ...velocity, y: Math.max(-maxFall, velocity.y - gravity * (1 - buoyancy * medium.submersion) * dt) };
  if (surfaceJump)
    velocity = { ...velocity, y: Math.max(velocity.y, config.waterSurfaceJumpSpeed ?? config.jumpSpeed ?? 6.5) };
  return velocity;
};

const sensorContacts = (state: BodyState, config: BodyConfig, world: PhysicsWorld): Contact[] => {
  const bounds = bodyWorldAabb(state, config);
  return world
    .querySolids(bounds)
    .map((collider) => {
      if (!validateCollider(collider)) throw new RangeError('碰撞查询返回了无效碰撞箱。');
      return collider;
    })
    .filter((collider) => collider.sensor && colliderMatches(config, collider) && overlapDepth(bounds, collider.aabb))
    .sort((left, right) => (left.id ?? '').localeCompare(right.id ?? ''))
    .map((collider) => contactAt(state.position, config, ZERO, collider));
};

export const stepBody = (
  options: Readonly<{ state: BodyState; config: BodyConfig; input: PhysicsInput; world: PhysicsWorld; dt: number }>,
): PhysicsStepResult => {
  const { state, config, input, world, dt } = options;
  assertValid(state, config, input, dt);
  const initialBounds = bodyWorldAabb(state, config);
  const groundedBefore = supported(initialBounds, config, world);
  const initialFluids = world.sampleFluid?.(initialBounds);
  const initialMedium = mediumAt(initialBounds, initialFluids);
  const surfaceJump =
    input.jumpPressed && initialMedium.submersion > 0 && reachesFluidSurface(initialBounds, initialFluids);
  const velocity = integrateVelocity(state, config, input, groundedBefore, initialMedium, surfaceJump, dt);
  const sweep = sweepBodyThroughWorld({ ...state, velocity }, config, world, scale(velocity, dt));
  const contacts = sweep.contacts.map((contact) =>
    contactAt(contact.position, config, contact.normal, contact.collider),
  );
  const moved = { state: { position: sweep.position, velocity }, contacts };
  const grounded = supported(bodyWorldAabb(moved.state, config), config, world);
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
