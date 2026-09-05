export type Vec3 = Readonly<{ x: number; y: number; z: number }>;

export type WorldAabb = Readonly<{ min: Vec3; max: Vec3 }>;
export type LocalAabb = WorldAabb;

export type BodyConfig = Readonly<{
  localAabb: LocalAabb;
  collisionLayer?: number;
  collisionMask?: number;
  pushable?: boolean;
  gravity?: number;
  terminalVelocity?: number;
  maxHorizontalSpeed?: number;
  groundAcceleration?: number;
  airAcceleration?: number;
  jumpSpeed?: number;
  waterSurfaceJumpSpeed?: number;
  buoyancy?: number;
  fluidDrag?: number;
  swimAcceleration?: number;
}>;

export type BodyState = Readonly<{ position: Vec3; velocity: Vec3 }>;

export type PhysicsInput = Readonly<{
  wish: Readonly<{ x: number; z: number }>;
  jumpPressed: boolean;
  verticalIntent: -1 | 0 | 1;
}>;

export type Collider = Readonly<{
  id?: string;
  aabb: WorldAabb;
  layer?: number;
  mask?: number;
  sensor?: boolean;
}>;

export type FluidVolume = Readonly<{ aabb: WorldAabb; velocity: Vec3 }>;

/**
 * `querySolids` includes known solid sub-boxes and, when configured by the
 * runtime, synthetic blockers for unknown chunks. Unknown space is therefore
 * never silently interpreted as air by the solver.
 */
export type PhysicsWorld = Readonly<{
  querySolids: (bounds: WorldAabb) => readonly Collider[];
  sampleFluid?: (bounds: WorldAabb) => readonly FluidVolume[];
}>;

export type Contact = Readonly<{ colliderId?: string; normal: Vec3; point: Vec3 }>;

export type MediumSample = Readonly<{ submersion: number; flow: Vec3 }>;

export type PhysicsStepResult = Readonly<{
  state: BodyState;
  contacts: readonly Contact[];
  sensors: readonly Contact[];
  grounded: boolean;
  medium: MediumSample;
}>;

export type RecoveryResult = Readonly<{ state: BodyState; recovered: boolean; distance: number }>;

/**
 * `separated` means the two body boxes no longer overlap.  A bounded push may
 * still move one or both bodies while returning `false` when a wall or the
 * caller's per-body distance limit prevents a full separation.
 */
export type SeparationResult = Readonly<{ left: BodyState; right: BodyState; separated: boolean }>;
