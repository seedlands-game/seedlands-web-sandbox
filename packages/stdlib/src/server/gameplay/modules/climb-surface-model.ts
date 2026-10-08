import type { Vec3, WorldAabb } from '../../../physics/types';

const NAMESPACE_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const CONTACT_EPSILON = 1e-6;
const MAX_CONTACT_THICKNESS = 1;
const MAX_CLIMB_SPEED = 64;

export type ClimbFaceNormalV1 =
  | Readonly<{ x: -1; y: 0; z: 0 }>
  | Readonly<{ x: 1; y: 0; z: 0 }>
  | Readonly<{ x: 0; y: 0; z: -1 }>
  | Readonly<{ x: 0; y: 0; z: 1 }>;

export type ClimbSurfaceDefinitionV1 = Readonly<{
  version: 1;
  variant: string;
  faceNormal: ClimbFaceNormalV1;
  contactThickness: number;
  maxUpSpeed: number;
  maxDownSpeed: number;
  requiresHorizontalContact: boolean;
}>;

export type LoadedClimbSurfaceV1 = Readonly<{
  variant: string;
  aabb: WorldAabb;
  contactNormal: ClimbFaceNormalV1 | null;
}>;

export type ClimbCollisionSampleV1 =
  Readonly<{ status: 'unknown' }> | Readonly<{ status: 'loaded'; surface: LoadedClimbSurfaceV1 | null }>;

export type ClimbConstraintInputV1 = Readonly<{
  actor: Readonly<{
    aabb: WorldAabb;
    velocity: Vec3;
    verticalIntent: -1 | 0 | 1;
    grounded: boolean;
  }>;
  collision: ClimbCollisionSampleV1;
}>;

export type ClimbNotClimbingReasonV1 =
  'unknown-boundary' | 'no-surface' | 'unknown-variant' | 'zero-intent' | 'wrong-face' | 'no-contact';

export type ClimbConstraintResultV1 =
  | Readonly<{ status: 'climbing'; velocity: Vec3 }>
  | Readonly<{ status: 'not-climbing'; reason: ClimbNotClimbingReasonV1 }>;

type ClimbSurfaceDefinitionInputV1 = Readonly<{
  version: 1;
  variant: string;
  faceNormal: Readonly<{ x: number; y: number; z: number }>;
  contactThickness: number;
  maxUpSpeed: number;
  maxDownSpeed: number;
  requiresHorizontalContact: boolean;
}>;

const finiteVec3 = (value: unknown): value is Vec3 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const vector = value as Record<string, unknown>;
  return (
    Object.keys(vector).length === 3 &&
    Number.isFinite(vector.x) &&
    Number.isFinite(vector.y) &&
    Number.isFinite(vector.z)
  );
};

const finiteAabb = (value: unknown): value is WorldAabb => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const aabb = value as { min?: unknown; max?: unknown };
  if (!finiteVec3(aabb.min) || !finiteVec3(aabb.max)) return false;
  return aabb.min.x < aabb.max.x && aabb.min.y < aabb.max.y && aabb.min.z < aabb.max.z;
};

const cloneVec3 = (value: Vec3): Vec3 => Object.freeze({ x: value.x, y: value.y, z: value.z });
const cloneAabb = (value: WorldAabb): WorldAabb =>
  Object.freeze({ min: cloneVec3(value.min), max: cloneVec3(value.max) });

const cloneFaceNormal = (value: unknown, label: string): ClimbFaceNormalV1 => {
  if (!finiteVec3(value)) throw new TypeError(`${label} is invalid.`);
  const horizontalAxisCount = Number(Math.abs(value.x) === 1) + Number(Math.abs(value.z) === 1);
  if (value.y !== 0 || horizontalAxisCount !== 1 || (value.x !== 0 && value.z !== 0))
    throw new TypeError(`${label} must be a horizontal unit-axis normal.`);
  return cloneVec3(value) as ClimbFaceNormalV1;
};

const positiveBounded = (value: unknown, maximum: number, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > maximum)
    throw new TypeError(`${label} is invalid.`);
  return value;
};

export function defineClimbSurfaceV1(input: ClimbSurfaceDefinitionInputV1): ClimbSurfaceDefinitionV1 {
  if (!input || input.version !== 1) throw new TypeError('Climb surface version is invalid.');
  if (typeof input.variant !== 'string' || !NAMESPACE_ID.test(input.variant))
    throw new TypeError('Climb surface variant must be namespace-qualified.');
  if (typeof input.requiresHorizontalContact !== 'boolean')
    throw new TypeError('Climb surface horizontal contact policy is invalid.');
  return Object.freeze({
    version: 1,
    variant: input.variant,
    faceNormal: cloneFaceNormal(input.faceNormal, 'Climb surface face normal'),
    contactThickness: positiveBounded(input.contactThickness, MAX_CONTACT_THICKNESS, 'Climb surface contact thickness'),
    maxUpSpeed: positiveBounded(input.maxUpSpeed, MAX_CLIMB_SPEED, 'Climb surface upward speed'),
    maxDownSpeed: positiveBounded(input.maxDownSpeed, MAX_CLIMB_SPEED, 'Climb surface downward speed'),
    requiresHorizontalContact: input.requiresHorizontalContact,
  });
}

const sameFace = (left: ClimbFaceNormalV1, right: ClimbFaceNormalV1): boolean =>
  left.x === right.x && left.y === right.y && left.z === right.z;

const overlap = (leftMin: number, leftMax: number, rightMin: number, rightMax: number): boolean =>
  Math.min(leftMax, rightMax) - Math.max(leftMin, rightMin) > CONTACT_EPSILON;

const touchesConfiguredFace = (
  actor: WorldAabb,
  surface: WorldAabb,
  normal: ClimbFaceNormalV1,
  thickness: number,
): boolean => {
  if (!overlap(actor.min.y, actor.max.y, surface.min.y, surface.max.y)) return false;
  let gap: number;
  if (normal.x === 1) {
    if (!overlap(actor.min.z, actor.max.z, surface.min.z, surface.max.z)) return false;
    gap = actor.min.x - surface.max.x;
  } else if (normal.x === -1) {
    if (!overlap(actor.min.z, actor.max.z, surface.min.z, surface.max.z)) return false;
    gap = surface.min.x - actor.max.x;
  } else if (normal.z === 1) {
    if (!overlap(actor.min.x, actor.max.x, surface.min.x, surface.max.x)) return false;
    gap = actor.min.z - surface.max.z;
  } else {
    if (!overlap(actor.min.x, actor.max.x, surface.min.x, surface.max.x)) return false;
    gap = surface.min.z - actor.max.z;
  }
  return gap >= -CONTACT_EPSILON && gap <= thickness + CONTACT_EPSILON;
};

const validateActor = (actor: ClimbConstraintInputV1['actor']): void => {
  if (
    !actor ||
    !finiteAabb(actor.aabb) ||
    !finiteVec3(actor.velocity) ||
    ![-1, 0, 1].includes(actor.verticalIntent) ||
    typeof actor.grounded !== 'boolean'
  )
    throw new TypeError('Climb actor input is invalid.');
};

const cloneLoadedSurface = (raw: LoadedClimbSurfaceV1): LoadedClimbSurfaceV1 => {
  if (typeof raw.variant !== 'string' || !NAMESPACE_ID.test(raw.variant) || !finiteAabb(raw.aabb))
    throw new TypeError('Loaded climb surface is invalid.');
  return Object.freeze({
    variant: raw.variant,
    aabb: cloneAabb(raw.aabb),
    contactNormal: raw.contactNormal ? cloneFaceNormal(raw.contactNormal, 'Loaded climb surface contact normal') : null,
  });
};

export function constrainClimbVelocityV1(
  definition: ClimbSurfaceDefinitionV1,
  input: ClimbConstraintInputV1,
): ClimbConstraintResultV1 {
  const surfaceDefinition = defineClimbSurfaceV1(definition);
  validateActor(input.actor);
  if (!input.collision || input.collision.status === 'unknown')
    return Object.freeze({ status: 'not-climbing', reason: 'unknown-boundary' });
  if (input.collision.status !== 'loaded') throw new TypeError('Climb collision sample status is invalid.');
  if (!input.collision.surface) return Object.freeze({ status: 'not-climbing', reason: 'no-surface' });
  const surface = cloneLoadedSurface(input.collision.surface);
  if (surface.variant !== surfaceDefinition.variant)
    return Object.freeze({ status: 'not-climbing', reason: 'unknown-variant' });
  if (input.actor.verticalIntent === 0) return Object.freeze({ status: 'not-climbing', reason: 'zero-intent' });
  if (surface.contactNormal && !sameFace(surface.contactNormal, surfaceDefinition.faceNormal))
    return Object.freeze({ status: 'not-climbing', reason: 'wrong-face' });
  if (surfaceDefinition.requiresHorizontalContact && !surface.contactNormal)
    return Object.freeze({ status: 'not-climbing', reason: 'no-contact' });
  if (
    !touchesConfiguredFace(
      input.actor.aabb,
      surface.aabb,
      surfaceDefinition.faceNormal,
      surfaceDefinition.contactThickness,
    )
  )
    return Object.freeze({ status: 'not-climbing', reason: 'no-contact' });
  return Object.freeze({
    status: 'climbing',
    velocity: Object.freeze({
      x: input.actor.velocity.x,
      y: input.actor.verticalIntent === 1 ? surfaceDefinition.maxUpSpeed : -surfaceDefinition.maxDownSpeed,
      z: input.actor.velocity.z,
    }),
  });
}
