import type { ActorComponentSnapshot } from './ecs-actor-components';
import type { EcsEntityOwner, EntityLifetimeReference } from './ecs-entity-owner';
import type { StationComponentV1, StationKind } from './ecs-station-state';
import type { EntitySpawn, GameplayEntity } from './entity-store';
import type { ItemStack } from './item-registry';
import type { TransportSpawnState } from './ecs-transport-state';
import type { TransportComponentV1 } from './modules/transport-model';

export type PreparedActorReplacement = Readonly<{
  reference: EntityLifetimeReference;
  health: number;
  components: ActorComponentSnapshot;
  position?: readonly [number, number, number];
  physicsVelocity?: readonly [number, number, number];
}>;

export type PreparedWorldItemSpawn = Readonly<{
  id?: string;
  position: readonly [number, number, number];
  physicsVelocity?: readonly [number, number, number];
  stack: ItemStack;
}>;

export type PreparedStationReplacement = Readonly<{
  reference: EntityLifetimeReference;
  snapshot: StationComponentV1;
}>;

export type PreparedStationSpawn = Readonly<{
  id?: string;
  position: readonly [number, number, number];
  kind: StationKind;
}>;

export type PreparedTransportSpawn = Readonly<{
  id?: string;
  position: readonly [number, number, number];
  physicsVelocity?: readonly [number, number, number];
  transport: TransportSpawnState;
}>;
export type PreparedTransportReplacement = Readonly<{
  reference: EntityLifetimeReference;
  snapshot: TransportComponentV1;
  position?: readonly [number, number, number];
  physicsVelocity?: readonly [number, number, number];
}>;

export type PreparedEntityMutationInput = Readonly<{
  dynamics?: readonly Readonly<{
    reference: EntityLifetimeReference;
    position?: readonly [number, number, number];
    physicsVelocity?: readonly [number, number, number];
  }>[];
  actors?: readonly PreparedActorReplacement[];
  stations?: readonly PreparedStationReplacement[];
  worldItems?: readonly Readonly<{ reference: EntityLifetimeReference; count: number }>[];
  spawns?: readonly PreparedWorldItemSpawn[];
  stationSpawns?: readonly PreparedStationSpawn[];
  transports?: readonly PreparedTransportReplacement[];
  transportSpawns?: readonly PreparedTransportSpawn[];
  despawns?: readonly EntityLifetimeReference[];
}>;

export type PreparedEntityMutationResult = Readonly<{
  actorIds: readonly string[];
  stationIds: readonly string[];
  despawnedIds: readonly string[];
  spawned: readonly GameplayEntity[];
}>;

export type PreparedEntityMutation = Readonly<{
  spawnIds: readonly string[];
  validate(): void;
  apply(): PreparedEntityMutationResult;
}>;

export type PreparedEntityMutationHost = Readonly<{
  owner: EcsEntityOwner;
  sequence: number;
  isCurrent(owner: EcsEntityOwner, sequence: number): boolean;
  prepareWorldItem(input: EntitySpawn, id: string): GameplayEntity;
  prepareStation(
    input: Readonly<{ position: readonly [number, number, number]; kind: StationKind }>,
    id: string,
  ): Readonly<{ entity: GameplayEntity; station: StationComponentV1 }>;
  prepareTransport(
    input: PreparedTransportSpawn,
    id: string,
  ): Readonly<{ entity: GameplayEntity; transport: TransportComponentV1 }>;
  removeFromBucket(entity: GameplayEntity): void;
  addToBucket(entity: GameplayEntity): void;
  commitSequence(sequence: number): void;
}>;
