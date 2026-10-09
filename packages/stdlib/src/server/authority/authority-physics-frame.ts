import type { BodyConfig, PhysicsWorld } from '../../physics';
import type { EntityLifetimeReference } from '../gameplay/entity-store';

export type AuthorityPhysicsUpdate = Readonly<{
  id: string;
  update: { position: [number, number, number]; physicsVelocity: [number, number, number] };
}>;

/** A synchronous Host-only frontier; functions and normal body data never enter module state. */
export type AuthorityPhysicsFrame = Readonly<{
  epoch: string;
  physicsTick: number;
  seconds: number;
  playerReference: EntityLifetimeReference | null;
  playerWish: Readonly<{ x: number; z: number }>;
  acknowledgedSequence: number;
  updates: readonly AuthorityPhysicsUpdate[];
  world: PhysicsWorld;
  bodyConfigs: ReadonlyMap<string, BodyConfig>;
}>;
