export { bodyWorldAabb, sweepBodyThroughWorld, validateBodyConfig, validateCollider } from './geometry';
export { CollisionLayer, bodyConfigFor, bodyKindForEntity, type BodyKind } from './body-registry';
export { recoverBody, separateBodies } from './recovery';
export { probeBodyContacts, stepBody } from './step-body';
export type {
  BodyConfig,
  BodyContactProbe,
  BodyState,
  Collider,
  Contact,
  FluidVolume,
  LocalAabb,
  MediumSample,
  PhysicsInput,
  PhysicsStepResult,
  PhysicsWorld,
  RecoveryResult,
  SeparationResult,
  Vec3,
  WorldAabb,
} from './types';
