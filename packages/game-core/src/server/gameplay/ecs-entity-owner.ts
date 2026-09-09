import { cloneItemStack } from './item-instance';
import {
  addComponent,
  addEntity,
  commitRemovals,
  createWorld,
  deleteWorld,
  entityExists,
  hasComponent,
  query,
  registerComponents,
  removeEntity,
  type EntityId,
  type World,
} from 'bitecs';
import { defaultItemDefinitionRegistry, type ItemDefinitionRegistry, type ItemStack } from './item-registry';
import { createActorComponents } from './ecs-actor-components';
import {
  initializeActorComponents,
  clearActorComponents,
  createActorStateAccess,
  createPlayerStateAccess,
  installPreparedActorComponentSnapshot,
  prepareActorComponentSnapshot,
  readActorComponentSnapshot,
  readActorNeeds,
  restoreActorComponentSnapshot,
  type PreparedActorComponentSnapshot,
} from './ecs-actor-state';
import type { ActorComponentSnapshot } from './ecs-actor-components';

export type EcsEntityType = 'player' | 'world-item' | 'creature' | 'npc';
export type EcsActorArchetype = 'grazer' | 'night-stalker' | 'settler';
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

type SlotArray<Value> = Array<Value | undefined>;
type EntityComponents = ReturnType<typeof createEntityComponents>;

const createEntityComponents = () => ({
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
});

const clone = (entity: EcsOwnedEntity): EcsOwnedEntity => ({
  ...entity,
  position: [...entity.position],
  ...(entity.physicsVelocity ? { physicsVelocity: [...entity.physicsVelocity] } : {}),
  ...(entity.stack ? { stack: cloneItemStack(entity.stack) } : {}),
});

/** Per-world bitECS owner; recyclable EIDs and component storage stay private. */
export class EcsEntityOwner {
  private readonly world: World;
  private readonly components: EntityComponents;
  private readonly actors = createActorComponents();
  private readonly ids = new Map<string, EntityId>();
  private readonly issued = new Set<string>();
  private readonly usedLifetimes = new Set<number>();
  private lifetimeSequence = 0;
  private orderSequence = 0;
  private disposed = false;

  constructor(
    private readonly worldEpoch = 1,
    private readonly items: ItemDefinitionRegistry = defaultItemDefinitionRegistry,
  ) {
    if (!Number.isSafeInteger(worldEpoch) || worldEpoch <= 0)
      throw new RangeError('Entity world epoch must be a positive safe integer.');
    this.world = createWorld();
    this.components = createEntityComponents();
    registerComponents(this.world, [...Object.values(this.components), ...Object.values(this.actors)]);
  }

  create(entity: EcsOwnedEntity): EcsOwnedEntity {
    return this.createWithLifetime(entity);
  }

  createRestored(entity: EcsOwnedEntity, lifetime: number): EcsOwnedEntity {
    if (!Number.isSafeInteger(lifetime) || lifetime <= 0 || this.usedLifetimes.has(lifetime))
      throw new TypeError(`Entity lifetime is invalid or duplicated: ${entity.id}`);
    return this.createWithLifetime(entity, lifetime);
  }

  /** Installs a world item that the EntityStore prepared and freshness-checked. */
  createPreparedWorldItem(entity: EcsOwnedEntity): EcsOwnedEntity {
    return this.installEntity(entity);
  }

  private createWithLifetime(entity: EcsOwnedEntity, restoredLifetime?: number): EcsOwnedEntity {
    this.assertAvailable();
    if (entity.stack) this.items.assertStack(entity.stack);
    if (this.ids.has(entity.id)) throw new Error(`Entity already exists: ${entity.id}`);
    if (this.issued.has(entity.id)) throw new Error(`Entity id was already issued or retired: ${entity.id}`);
    if (restoredLifetime === undefined && this.lifetimeSequence >= Number.MAX_SAFE_INTEGER)
      throw new RangeError('Entity lifetime sequence is exhausted.');
    if (this.orderSequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Entity order sequence is exhausted.');

    return this.installEntity(entity, restoredLifetime);
  }

  private installEntity(entity: EcsOwnedEntity, restoredLifetime?: number): EcsOwnedEntity {
    // bitECS defers query removals; flush before allocation so a recycled EID
    // cannot retain membership from its previous lifetime.
    commitRemovals(this.world);
    const eid = addEntity(this.world);
    const components = this.components;
    addComponent(this.world, eid, components.identity);
    addComponent(this.world, eid, components.lifecycle);
    addComponent(this.world, eid, components.transform);
    addComponent(this.world, eid, this.typeComponent(entity.type));
    if (entity.physicsVelocity) addComponent(this.world, eid, components.velocity);
    if (entity.health !== undefined && entity.maxHealth !== undefined) addComponent(this.world, eid, components.health);
    if (entity.stack) addComponent(this.world, eid, components.itemStack);
    if (entity.archetype) addComponent(this.world, eid, components.actorMetadata);

    components.identity.id[eid] = entity.id;
    const lifetime = restoredLifetime ?? this.lifetimeSequence + 1;
    this.lifetimeSequence = Math.max(this.lifetimeSequence, lifetime);
    this.usedLifetimes.add(lifetime);
    components.identity.lifetime[eid] = lifetime;
    components.identity.order[eid] = ++this.orderSequence;
    components.lifecycle.active[eid] = 1;
    this.writePosition(components.transform, eid, entity.position);
    if (entity.physicsVelocity) this.writePosition(components.velocity, eid, entity.physicsVelocity);
    if (entity.health !== undefined && entity.maxHealth !== undefined) {
      components.health.current[eid] = entity.health;
      components.health.maximum[eid] = entity.maxHealth;
    }
    if (entity.stack) {
      components.itemStack.itemId[eid] = entity.stack.itemId;
      components.itemStack.count[eid] = entity.stack.count;
      components.itemStack.durability[eid] = entity.stack.instance?.durability;
    }
    if (entity.archetype) {
      components.actorMetadata.archetype[eid] = entity.archetype;
      components.actorMetadata.persistent[eid] = entity.persistent ?? true;
    }
    initializeActorComponents(this.world, this.actors, eid, entity, this.items);
    this.ids.set(entity.id, eid);
    this.issued.add(entity.id);
    return this.project(eid);
  }

  get(id: string): EcsOwnedEntity | null {
    const eid = this.resolve(id);
    return eid === null ? null : this.project(eid);
  }

  query(filter: EcsEntityQuery = {}): EcsOwnedEntity[] {
    this.assertAvailable();
    const terms: object[] = [this.components.identity, this.components.lifecycle, this.components.transform];
    if (filter.type) terms.push(this.typeComponent(filter.type));
    return Array.from(query(this.world, terms))
      .filter((eid) => this.isCurrent(eid))
      .sort(
        (left, right) =>
          (this.components.identity.order[left] ?? Number.MAX_SAFE_INTEGER) -
          (this.components.identity.order[right] ?? Number.MAX_SAFE_INTEGER),
      )
      .map((eid) => this.project(eid));
  }

  setPosition(id: string, position: EcsPosition): void {
    this.writePosition(this.components.transform, this.require(id), position);
  }

  setVelocity(id: string, velocity: EcsPosition): void {
    const eid = this.require(id);
    if (!hasComponent(this.world, eid, this.components.velocity))
      addComponent(this.world, eid, this.components.velocity);
    this.writePosition(this.components.velocity, eid, velocity);
  }

  setHealth(id: string, health: number): void {
    const eid = this.require(id);
    if (!hasComponent(this.world, eid, this.components.health)) throw new TypeError('Entity does not own health.');
    const maximum = this.components.health.maximum[eid]!;
    if (!Number.isFinite(health) || health < 0 || health > maximum)
      throw new TypeError('Entity health update is invalid.');
    this.components.health.current[eid] = health;
    this.actors.life.lifecycle[eid] = health === 0 ? 'dead' : 'alive';
  }

  setStackCount(id: string, count: number): void {
    const eid = this.require(id);
    if (!hasComponent(this.world, eid, this.components.itemStack))
      throw new TypeError('Entity does not own an item stack.');
    this.components.itemStack.count[eid] = count;
  }

  destroy(id: string): boolean {
    const eid = this.resolve(id);
    if (eid === null) return false;
    removeEntity(this.world, eid);
    this.ids.delete(id);
    this.clearSlot(eid);
    return true;
  }

  actorStateAccess(id: string) {
    return createActorStateAccess(this.actors, this.actorBindings(id));
  }

  playerStateAccess(id: string) {
    if (this.get(id)?.type !== 'player') throw new RangeError(`Unknown player: ${id}`);
    return createPlayerStateAccess(this.actors, this.actorBindings(id));
  }

  actorNeedsSnapshot(id: string) {
    const eid = this.require(id);
    if (this.project(eid).type === 'world-item') throw new TypeError('World items have no needs.');
    return readActorNeeds(this.actors, eid);
  }

  actorComponentSnapshot(id: string): ActorComponentSnapshot {
    const eid = this.require(id);
    const entity = this.project(eid);
    if (entity.type === 'world-item') throw new TypeError(`World item does not have actor components: ${id}`);
    return readActorComponentSnapshot(this.actors, eid, id, entity.type === 'player');
  }

  prepareActorComponentSnapshot(id: string, snapshot: ActorComponentSnapshot): PreparedActorComponentSnapshot {
    const eid = this.require(id);
    const entity = this.project(eid);
    if (entity.type === 'world-item') throw new TypeError(`World item does not have actor components: ${id}`);
    return prepareActorComponentSnapshot(snapshot, entity.type === 'player', this.items);
  }

  installPreparedActorReplacement(
    id: string,
    health: number,
    prepared: PreparedActorComponentSnapshot,
    spatial: PreparedActorSpatialReplacement = {},
  ): void {
    const eid = this.require(id);
    if (spatial.position) this.writePosition(this.components.transform, eid, spatial.position);
    if (spatial.physicsVelocity) {
      if (!hasComponent(this.world, eid, this.components.velocity))
        addComponent(this.world, eid, this.components.velocity);
      this.writePosition(this.components.velocity, eid, spatial.physicsVelocity);
    }
    this.components.health.current[eid] = health;
    installPreparedActorComponentSnapshot(this.actors, eid, prepared);
  }

  restoreActorComponentSnapshot(snapshot: ActorComponentSnapshot): void {
    const eid = this.require(snapshot.entityId);
    const entity = this.project(eid);
    if (entity.type === 'world-item') throw new TypeError('World item cannot restore actor components.');
    if ((entity.health === 0) !== (snapshot.lifecycle === 'dead'))
      throw new TypeError('Actor lifecycle does not match entity health.');
    restoreActorComponentSnapshot(this.actors, eid, snapshot, entity.type === 'player', this.items);
  }

  private actorBindings(id: string) {
    const reference = this.createReference(id);
    if (!reference || !hasComponent(this.world, this.require(id), this.actors.needs))
      throw new RangeError(`Unknown inventory actor: ${id}`);
    const resolve = () => {
      if (this.disposed || !this.resolveReference(reference))
        throw new Error('Stale actor lifetime or epoch reference.');
      return this.require(id);
    };
    return {
      resolve,
      health: () => {
        const eid = resolve();
        return { health: this.components.health.current[eid]!, maxHealth: this.components.health.maximum[eid]! };
      },
      setHealth: (value: number) => {
        resolve();
        this.setHealth(id, value);
      },
    };
  }

  createReference(id: string): EntityLifetimeReference | null {
    const eid = this.resolve(id);
    if (eid === null) return null;
    return Object.freeze({ entityId: id, epoch: this.worldEpoch, lifetime: this.components.identity.lifetime[eid]! });
  }

  resolveReference(reference: EntityLifetimeReference): EcsOwnedEntity | null {
    if (reference.epoch !== this.worldEpoch) return null;
    const eid = this.resolve(reference.entityId);
    if (eid === null || this.components.identity.lifetime[eid] !== reference.lifetime) return null;
    return this.project(eid);
  }

  isIssued(id: string): boolean {
    return this.issued.has(id);
  }

  issuedIds(): ReadonlySet<string> {
    return new Set(this.issued);
  }

  reserveIssued(ids: Iterable<string>): void {
    for (const id of ids) this.issued.add(id);
  }

  setLifetimeHighWater(value: number): void {
    if (!Number.isSafeInteger(value) || value < this.lifetimeSequence)
      throw new TypeError('Entity lifetime high-water mark is invalid.');
    this.lifetimeSequence = value;
  }

  validateCreateCapacity(count: number): void {
    this.assertAvailable();
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('Entity create capacity is invalid.');
    if (this.lifetimeSequence > Number.MAX_SAFE_INTEGER - count || this.orderSequence > Number.MAX_SAFE_INTEGER - count)
      throw new RangeError('Entity lifetime or order capacity is exhausted.');
  }

  identitySnapshots(): EntityLifetimeSnapshot[] {
    return this.query().map((entity) => {
      const reference = this.createReference(entity.id)!;
      return { entityId: entity.id, lifetime: reference.lifetime };
    });
  }

  get lifetimeHighWater(): number {
    return this.lifetimeSequence;
  }

  get orderHighWater(): number {
    return this.orderSequence;
  }

  get epoch(): number {
    return this.worldEpoch;
  }

  dispose(): void {
    if (this.disposed) return;
    for (const eid of this.ids.values()) this.clearSlot(eid);
    deleteWorld(this.world);
    this.ids.clear();
    this.disposed = true;
  }

  private project(eid: EntityId): EcsOwnedEntity {
    const components = this.components;
    const type = this.typeOf(eid);
    const entity: EcsOwnedEntity = {
      id: components.identity.id[eid]!,
      type,
      kind: type,
      lifecycle: 'active',
      position: this.readPosition(components.transform, eid),
    };
    if (hasComponent(this.world, eid, components.velocity))
      entity.physicsVelocity = this.readPosition(components.velocity, eid);
    if (hasComponent(this.world, eid, components.health)) {
      entity.health = components.health.current[eid]!;
      entity.maxHealth = components.health.maximum[eid]!;
    }
    if (hasComponent(this.world, eid, components.itemStack))
      entity.stack = {
        itemId: components.itemStack.itemId[eid]!,
        count: components.itemStack.count[eid]!,
        ...(components.itemStack.durability[eid] === undefined
          ? {}
          : { instance: Object.freeze({ durability: components.itemStack.durability[eid]! }) }),
      };
    if (hasComponent(this.world, eid, components.actorMetadata)) {
      entity.archetype = components.actorMetadata.archetype[eid]!;
      entity.persistent = components.actorMetadata.persistent[eid]!;
    }
    return clone(entity);
  }

  private typeOf(eid: EntityId): EcsEntityType {
    if (hasComponent(this.world, eid, this.components.player)) return 'player';
    if (hasComponent(this.world, eid, this.components.worldItem)) return 'world-item';
    if (hasComponent(this.world, eid, this.components.creature)) return 'creature';
    if (hasComponent(this.world, eid, this.components.npc)) return 'npc';
    throw new Error('Entity type component is missing.');
  }

  private typeComponent(type: EcsEntityType): object {
    if (type === 'player') return this.components.player;
    if (type === 'world-item') return this.components.worldItem;
    if (type === 'creature') return this.components.creature;
    return this.components.npc;
  }

  private resolve(id: string): EntityId | null {
    this.assertAvailable();
    const eid = this.ids.get(id);
    return eid !== undefined && this.isCurrent(eid) ? eid : null;
  }

  private require(id: string): EntityId {
    const eid = this.resolve(id);
    if (eid === null) throw new Error(`Unknown entity: ${id}`);
    return eid;
  }

  private isCurrent(eid: EntityId): boolean {
    if (!entityExists(this.world, eid) || !hasComponent(this.world, eid, this.components.identity)) return false;
    const id = this.components.identity.id[eid];
    return id !== undefined && this.ids.get(id) === eid;
  }

  private readPosition(
    component: EntityComponents['transform'] | EntityComponents['velocity'],
    eid: EntityId,
  ): EcsPosition {
    return [component.x[eid]!, component.y[eid]!, component.z[eid]!];
  }

  private writePosition(
    component: EntityComponents['transform'] | EntityComponents['velocity'],
    eid: EntityId,
    position: EcsPosition,
  ): void {
    component.x[eid] = position[0];
    component.y[eid] = position[1];
    component.z[eid] = position[2];
  }

  private clearSlot(eid: EntityId): void {
    clearActorComponents(this.actors, eid);
    for (const component of [
      this.components.identity.id,
      this.components.identity.lifetime,
      this.components.identity.order,
      this.components.lifecycle.active,
      this.components.transform.x,
      this.components.transform.y,
      this.components.transform.z,
      this.components.velocity.x,
      this.components.velocity.y,
      this.components.velocity.z,
      this.components.health.current,
      this.components.health.maximum,
      this.components.itemStack.itemId,
      this.components.itemStack.count,
      this.components.itemStack.durability,
      this.components.actorMetadata.archetype,
      this.components.actorMetadata.persistent,
    ])
      delete component[eid];
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error('Entity world is disposed.');
  }
}
