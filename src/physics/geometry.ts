import type { BodyConfig, BodyState, Vec3, WorldAabb } from './types';

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
