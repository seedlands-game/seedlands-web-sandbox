import { clearComponentSlot } from './ecs-component-storage';
import { addComponent, hasComponent, type EntityId, type World } from 'bitecs';
import type { ItemStack } from './item-registry';
import { cloneItemStack } from './item-instance';
import type {
  EcsActorArchetype,
  EcsEntityType,
  EcsOwnedEntity,
  EcsPosition,
  PreparedActorSpatialReplacement,
} from './ecs-entity-owner';

type SlotArray<Value> = Array<Value | undefined>;
export const createEntityComponents = () => ({
  identity: { id: [] as SlotArray<string>, lifetime: [] as SlotArray<number>, order: [] as SlotArray<number> },
  lifecycle: { active: [] as SlotArray<number> },
  transform: { x: [] as SlotArray<number>, y: [] as SlotArray<number>, z: [] as SlotArray<number> },
  velocity: { x: [] as SlotArray<number>, y: [] as SlotArray<number>, z: [] as SlotArray<number> },
  health: { current: [] as SlotArray<number>, maximum: [] as SlotArray<number> },
  itemStack: {
    itemId: [] as SlotArray<ItemStack['itemId']>,
    count: [] as SlotArray<number>,
    durability: [] as SlotArray<number>,
  },
  actorMetadata: {
    archetype: [] as SlotArray<EcsActorArchetype>,
    persistent: [] as SlotArray<boolean>,
  },
  player: {},
  worldItem: {},
  creature: {},
  npc: {},
  station: {},
  fallingBlock: {},
  painting: {},
  transport: {},
});
export type EntityComponents = ReturnType<typeof createEntityComponents>;

export function ecsEntityType(world: World, components: EntityComponents, eid: EntityId): EcsEntityType {
  if (hasComponent(world, eid, components.player)) return 'player';
  if (hasComponent(world, eid, components.worldItem)) return 'world-item';
  if (hasComponent(world, eid, components.creature)) return 'creature';
  if (hasComponent(world, eid, components.npc)) return 'npc';
  if (hasComponent(world, eid, components.station)) return 'station';
  if (hasComponent(world, eid, components.fallingBlock)) return 'falling-block';
  if (hasComponent(world, eid, components.painting)) return 'painting';
  if (hasComponent(world, eid, components.transport)) return 'transport';
  throw new Error('Entity type component is missing.');
}

export function ecsEntityTypeComponent(components: EntityComponents, type: EcsEntityType): object {
  if (type === 'player') return components.player;
  if (type === 'world-item') return components.worldItem;
  if (type === 'creature') return components.creature;
  if (type === 'npc') return components.npc;
  if (type === 'station') return components.station;
  if (type === 'falling-block') return components.fallingBlock;
  if (type === 'transport') return components.transport;
  return components.painting;
}

const readPosition = (
  component: EntityComponents['transform'] | EntityComponents['velocity'],
  eid: EntityId,
): EcsPosition => [component.x[eid]!, component.y[eid]!, component.z[eid]!];

export function writeEcsPosition(
  component: EntityComponents['transform'] | EntityComponents['velocity'],
  eid: EntityId,
  position: EcsPosition,
): void {
  component.x[eid] = position[0];
  component.y[eid] = position[1];
  component.z[eid] = position[2];
}

export function writePreparedSpatial(
  world: World,
  components: EntityComponents,
  eid: EntityId,
  spatial: PreparedActorSpatialReplacement,
): void {
  if (spatial.position) writeEcsPosition(components.transform, eid, spatial.position);
  if (spatial.physicsVelocity) {
    if (!hasComponent(world, eid, components.velocity)) addComponent(world, eid, components.velocity);
    writeEcsPosition(components.velocity, eid, spatial.physicsVelocity);
  }
}

export function projectEcsEntity(world: World, components: EntityComponents, eid: EntityId): EcsOwnedEntity {
  const type = ecsEntityType(world, components, eid);
  const entity: EcsOwnedEntity = {
    id: components.identity.id[eid]!,
    type,
    kind: type,
    lifecycle: 'active',
    position: readPosition(components.transform, eid),
  };
  if (hasComponent(world, eid, components.velocity)) entity.physicsVelocity = readPosition(components.velocity, eid);
  if (hasComponent(world, eid, components.health)) {
    entity.health = components.health.current[eid]!;
    entity.maxHealth = components.health.maximum[eid]!;
  }
  if (hasComponent(world, eid, components.itemStack))
    entity.stack = {
      itemId: components.itemStack.itemId[eid]!,
      count: components.itemStack.count[eid]!,
      ...(components.itemStack.durability[eid] === undefined
        ? {}
        : { instance: Object.freeze({ durability: components.itemStack.durability[eid]! }) }),
    };
  if (hasComponent(world, eid, components.actorMetadata)) {
    entity.archetype = components.actorMetadata.archetype[eid]!;
    entity.persistent = components.actorMetadata.persistent[eid]!;
  }
  return {
    ...entity,
    position: [...entity.position],
    ...(entity.physicsVelocity ? { physicsVelocity: [...entity.physicsVelocity] } : {}),
    ...(entity.stack ? { stack: cloneItemStack(entity.stack) } : {}),
  };
}

export function clearEcsEntityColumns(eid: EntityId, components: EntityComponents): void {
  clearComponentSlot(eid, [
    components.identity.id,
    components.identity.lifetime,
    components.identity.order,
    components.lifecycle.active,
    components.transform.x,
    components.transform.y,
    components.transform.z,
    components.velocity.x,
    components.velocity.y,
    components.velocity.z,
    components.health.current,
    components.health.maximum,
    components.itemStack.itemId,
    components.itemStack.count,
    components.itemStack.durability,
    components.actorMetadata.archetype,
    components.actorMetadata.persistent,
  ]);
}
