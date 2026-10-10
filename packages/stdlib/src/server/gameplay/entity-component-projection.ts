import type { EcsEntityOwner } from './ecs-entity-owner';
import type { EntityStoreComponentSnapshotV2 } from './entity-store';
import { isActorEntityType } from './ecs-actor-state';

export function projectEntityComponentSnapshot(
  owner: EcsEntityOwner,
  sequence: number,
  includeTransports: boolean,
): EntityStoreComponentSnapshotV2 {
  const entities = owner.queryAll();
  return {
    version: 2,
    sequence: sequence,
    lifetimeHighWater: owner.lifetimeHighWater,
    issuedIds: [...owner.issuedIds()].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    entities,
    identities: owner.identitySnapshots(),
    actors: entities
      .filter((entity) => isActorEntityType(entity.type))
      .map((entity) => owner.actorComponentSnapshot(entity.id)),
    stations: owner.queryStations().map((entity) => owner.stationSnapshot(entity.id)),
    ...(includeTransports
      ? {
          transports: entities
            .filter((entity) => entity.type === 'transport')
            .map((entity) => owner.transportComponentSnapshot(entity.id)),
        }
      : {}),
  };
}
