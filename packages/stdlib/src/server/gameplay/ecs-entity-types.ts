import type { ItemStack } from './item-registry';
import type { EcsActorArchetype } from './actor-archetype';

export type EcsEntityType =
  'player' | 'world-item' | 'creature' | 'npc' | 'station' | 'falling-block' | 'painting' | 'transport';
export type EcsEntityLifecycle = 'active' | 'despawned';
export type EcsPosition = [number, number, number];

export type EcsOwnedEntity = {
  id: string;
  type: EcsEntityType;
  kind: EcsEntityType;
  lifecycle: EcsEntityLifecycle;
  position: EcsPosition;
  physicsVelocity?: EcsPosition;
  stack?: ItemStack;
  health?: number;
  maxHealth?: number;
  archetype?: EcsActorArchetype;
  persistent?: boolean;
};

export type EcsEntityQuery = Readonly<{ type?: EcsEntityType }>;
export type EntityLifetimeReference = Readonly<{
  entityId: string;
  epoch: number;
  lifetime: number;
}>;
export type EntityLifetimeSnapshot = Readonly<{ entityId: string; lifetime: number }>;
export type PreparedActorSpatialReplacement = Readonly<{
  position?: EcsPosition;
  physicsVelocity?: EcsPosition;
}>;
