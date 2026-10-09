import type { ActorProfileRegistry } from './actor-profile';
import { isActorArchetype, type EcsPosition } from './ecs-entity-owner';
import { validateStationEntityInput, type StationStateCodec } from './ecs-station-state';
import type { TransportStateCodec } from './ecs-transport-state';
import type { EntitySpawn, EntityType, GameplayEntity } from './entity-store';
import type { ItemDefinitionRegistry } from './item-registry';

type Options = Readonly<{
  items: ItemDefinitionRegistry;
  stationCodec?: StationStateCodec;
  actorProfiles?: ActorProfileRegistry;
  transportCodec?: TransportStateCodec;
}>;

export function prepareEntitySpawn(input: EntitySpawn, id: string, type: EntityType, options: Options): GameplayEntity {
  assertPosition(input.position);
  const entity: GameplayEntity = { id, type, kind: type, lifecycle: 'active', position: [...input.position] };
  if (input.physicsVelocity) {
    assertPosition(input.physicsVelocity);
    entity.physicsVelocity = [...input.physicsVelocity];
  } else if (type !== 'player' && type !== 'station' && type !== 'painting') entity.physicsVelocity = [0, 0, 0];
  if (type === 'station') {
    validateStationEntityInput(input, options.stationCodec);
  } else if (input.station !== undefined) throw new TypeError('Station state requires a station entity.');
  if (type === 'transport') {
    if (!input.transport || !options.transportCodec)
      throw new TypeError('Transport creation requires a configured component.');
    if (
      input.stack !== undefined ||
      input.health !== undefined ||
      input.maxHealth !== undefined ||
      input.archetype !== undefined ||
      input.persistent !== undefined
    )
      throw new TypeError('Transport entities cannot own actor or item-stack fields.');
  } else if (input.transport !== undefined) throw new TypeError('Transport state requires a transport entity.');
  if (type === 'world-item') {
    if (!input.stack) throw new TypeError('World item entity requires an item stack.');
    entity.stack = options.items.normalizeStack(input.stack);
  }
  if (type === 'player') {
    const health = input.health ?? 20;
    if (
      (input.maxHealth !== undefined && input.maxHealth !== 20) ||
      !Number.isFinite(health) ||
      health < 0 ||
      health > 20
    )
      throw new TypeError('Player health must be finite and within its maximum.');
    entity.health = health;
    entity.maxHealth = 20;
  }
  if (type === 'creature' || type === 'npc') {
    const maxHealth = input.maxHealth ?? 12;
    const health = input.health ?? maxHealth;
    if (!Number.isFinite(maxHealth) || maxHealth <= 0 || !Number.isFinite(health) || health < 0 || health > maxHealth)
      throw new TypeError('Creature health must be finite and within its maximum.');
    entity.health = health;
    entity.maxHealth = maxHealth;
    const archetype = input.archetype ?? (type === 'creature' && !options.actorProfiles ? 'grazer' : undefined);
    if (archetype) {
      if (!isActorArchetype(archetype)) throw new TypeError(`Unsupported actor archetype: ${String(archetype)}`);
      const profile = options.actorProfiles?.require(archetype);
      if (profile && type !== profile.entityType)
        throw new TypeError('Actor entity type does not match its world actor profile.');
      entity.archetype = archetype;
      entity.persistent = input.persistent ?? true;
    }
  }
  return entity;
}

export function entityTypeForSpawn(input: EntitySpawn): EntityType {
  const type = input.type ?? input.kind;
  if (
    !['player', 'world-item', 'creature', 'npc', 'station', 'falling-block', 'painting', 'transport'].includes(
      type as string,
    )
  )
    throw new TypeError(`Unsupported entity type: ${String(type)}`);
  return type as EntityType;
}

export function assertPosition(position: readonly number[]): asserts position is EcsPosition {
  if (position.length !== 3 || !position.every(Number.isFinite))
    throw new TypeError('Entity position must contain three finite numbers.');
}
