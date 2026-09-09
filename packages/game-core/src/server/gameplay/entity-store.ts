import {
  EcsEntityOwner,
  type EcsActorArchetype,
  type EcsEntityLifecycle,
  type EcsEntityType,
  type EcsOwnedEntity,
  type EcsPosition,
  type EntityLifetimeSnapshot,
  type EntityLifetimeReference,
} from './ecs-entity-owner';
import type { ActorComponentSnapshot } from './ecs-actor-components';
import { assertItemStack } from './item-registry';

export type EntityType = EcsEntityType;
export type ActorArchetype = EcsActorArchetype;
export type EntityLifecycle = EcsEntityLifecycle;
type Position = EcsPosition;
export type GameplayEntity = EcsOwnedEntity;
export type { EntityLifetimeReference } from './ecs-entity-owner';

export type EntitySpawn = {
  id?: string;
  type?: EntityType;
  kind?: EntityType | string;
  position: readonly [number, number, number];
  physicsVelocity?: readonly [number, number, number];
  stack?: { itemId: string; count: number };
  health?: number;
  maxHealth?: number;
  archetype?: ActorArchetype;
  persistent?: boolean;
};

export type EntityUpdate = Partial<Pick<GameplayEntity, 'position' | 'physicsVelocity' | 'health'>>;
export type EntityQuery = { type?: EntityType };
export type EntityStoreComponentSnapshot = {
  version: 1;
  sequence: number;
  lifetimeHighWater: number;
  issuedIds: string[];
  entities: GameplayEntity[];
  identities: EntityLifetimeSnapshot[];
  actors: ActorComponentSnapshot[];
};

const bucketCoordinate = (value: number) => Math.floor(value / 8);
const bucketKey = (position: readonly number[]) => position.map(bucketCoordinate).join(',');

export class EntityStore {
  private owner = new EcsEntityOwner();
  private buckets = new Map<string, Set<string>>();
  private sequence = 0;
  private visitedBucketCount = 0;
  private visitedEntityCount = 0;
  private returnedEntityCount = 0;

  spawn(input: EntitySpawn): GameplayEntity {
    const type = this.entityType(input);
    const { id, sequence: nextSequence } = this.identityFor(this.owner, input, type, this.sequence);
    if (!id.trim()) throw new TypeError('Entity id must not be empty.');
    if (this.owner.get(id)) throw new Error(`Entity already exists: ${id}`);
    if (this.owner.isIssued(id)) throw new Error(`Entity id was already issued or retired: ${id}`);
    const entity = this.prepareEntity(input, id, type);
    const created = this.owner.create(entity);
    this.sequence = nextSequence;
    this.addToBucket(created, this.buckets);
    return created;
  }

  get(id: string): GameplayEntity | null {
    return this.owner.get(id);
  }

  update(id: string, update: EntityUpdate): GameplayEntity {
    this.updateWithoutSnapshot(id, update);
    return this.owner.get(id)!;
  }

  updateWithoutSnapshot(id: string, update: EntityUpdate): void {
    const entity = this.owner.get(id);
    if (!entity) throw new Error(`Unknown entity: ${id}`);
    if (update.position) this.moveEntity(entity, update.position);
    if (update.physicsVelocity) {
      this.assertPosition(update.physicsVelocity);
      this.owner.setVelocity(id, [...update.physicsVelocity]);
    }
    if (update.health !== undefined) {
      if (
        entity.health === undefined ||
        entity.maxHealth === undefined ||
        !Number.isFinite(update.health) ||
        update.health < 0 ||
        update.health > entity.maxHealth
      )
        throw new TypeError('Entity health update is invalid.');
      this.owner.setHealth(id, update.health);
    }
  }

  move(id: string, position: readonly [number, number, number]): GameplayEntity {
    const entity = this.owner.get(id);
    if (!entity) throw new Error(`Unknown entity: ${id}`);
    this.moveEntity(entity, position);
    return this.owner.get(id)!;
  }

  despawn(id: string): boolean {
    const entity = this.owner.get(id);
    if (!entity) return false;
    this.removeFromBucket(entity, this.buckets);
    return this.owner.destroy(id);
  }

  consumeWorldItemUnit(id: string): { itemId: string; remainingCount: number } | null {
    const entity = this.owner.get(id);
    if (!entity?.stack || entity.type !== 'world-item') return null;
    const itemId = entity.stack.itemId;
    const remainingCount = entity.stack.count - 1;
    if (remainingCount === 0) this.despawn(id);
    else this.owner.setStackCount(id, remainingCount);
    return { itemId, remainingCount };
  }

  query(filter: EntityQuery = {}): GameplayEntity[] {
    return this.owner.query(filter);
  }

  queryNearby(position: readonly [number, number, number], radius: number, filter: EntityQuery = {}): GameplayEntity[] {
    this.assertPosition(position);
    if (!Number.isFinite(radius) || radius < 0)
      throw new TypeError('Query radius must be a non-negative finite number.');
    const minimum = position.map((value) => bucketCoordinate(value - radius));
    const maximum = position.map((value) => bucketCoordinate(value + radius));
    const ids = new Set<string>();
    this.visitedBucketCount = 0;
    this.visitedEntityCount = 0;
    for (let x = minimum[0]; x <= maximum[0]; x += 1)
      for (let y = minimum[1]; y <= maximum[1]; y += 1)
        for (let z = minimum[2]; z <= maximum[2]; z += 1) {
          this.visitedBucketCount += 1;
          this.buckets.get(`${x},${y},${z}`)?.forEach((id) => ids.add(id));
        }
    const radiusSquared = radius * radius;
    this.visitedEntityCount = ids.size;
    const result = [...ids]
      .map((id) => this.owner.get(id))
      .filter(
        (entity): entity is GameplayEntity =>
          entity !== null &&
          (!filter.type || entity.type === filter.type) &&
          entity.position.reduce((sum, value, index) => sum + (value - position[index]) ** 2, 0) <= radiusSquared,
      );
    this.returnedEntityCount = result.length;
    return result;
  }

  metrics() {
    return {
      visitedBucketCount: this.visitedBucketCount,
      totalBucketCount: this.buckets.size,
      visitedEntityCount: this.visitedEntityCount,
      returnedEntityCount: this.returnedEntityCount,
    };
  }

  exportSnapshot(): GameplayEntity[] {
    return this.owner.query();
  }

  exportComponentSnapshot(): EntityStoreComponentSnapshot {
    const entities = this.owner.query();
    return {
      version: 1,
      sequence: this.sequence,
      lifetimeHighWater: this.owner.lifetimeHighWater,
      issuedIds: [...this.owner.issuedIds()].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
      entities,
      identities: this.owner.identitySnapshots(),
      actors: entities
        .filter((entity) => entity.type !== 'world-item')
        .map((entity) => this.owner.actorComponentSnapshot(entity.id)),
    };
  }

  restoreComponentSnapshot(raw: unknown): void {
    const snapshot = raw as EntityStoreComponentSnapshot;
    if (
      !snapshot ||
      snapshot.version !== 1 ||
      !Number.isSafeInteger(snapshot.sequence) ||
      snapshot.sequence < 0 ||
      !Number.isSafeInteger(snapshot.lifetimeHighWater) ||
      snapshot.lifetimeHighWater < 0 ||
      !Array.isArray(snapshot.issuedIds) ||
      !Array.isArray(snapshot.entities) ||
      !Array.isArray(snapshot.identities) ||
      !Array.isArray(snapshot.actors)
    )
      throw new TypeError('Entity component snapshot header is invalid.');
    if (this.owner.epoch >= Number.MAX_SAFE_INTEGER) throw new RangeError('Entity world epoch is exhausted.');

    const issued = new Set<string>();
    for (const id of snapshot.issuedIds) {
      if (typeof id !== 'string' || !id.trim() || issued.has(id))
        throw new TypeError('Issued entity ids are invalid or duplicated.');
      issued.add(id);
    }
    const identities = new Map<string, number>();
    const usedLifetimes = new Set<number>();
    for (const identity of snapshot.identities) {
      if (
        !identity ||
        typeof identity.entityId !== 'string' ||
        !identity.entityId.trim() ||
        !Number.isSafeInteger(identity.lifetime) ||
        identity.lifetime <= 0 ||
        identity.lifetime > snapshot.lifetimeHighWater ||
        identities.has(identity.entityId) ||
        usedLifetimes.has(identity.lifetime)
      )
        throw new TypeError('Entity identity snapshots are invalid or duplicated.');
      identities.set(identity.entityId, identity.lifetime);
      usedLifetimes.add(identity.lifetime);
    }
    const actorSnapshots = new Map<string, ActorComponentSnapshot>();
    for (const actor of snapshot.actors) {
      if (!actor || typeof actor.entityId !== 'string' || !actor.entityId.trim() || actorSnapshots.has(actor.entityId))
        throw new TypeError('Actor component snapshots are invalid or duplicated.');
      actorSnapshots.set(actor.entityId, actor);
    }

    const candidateOwner = new EcsEntityOwner(this.owner.epoch + 1);
    const candidateBuckets = new Map<string, Set<string>>();
    try {
      for (const input of snapshot.entities) {
        const type = this.entityType(input);
        if (input.id === undefined || input.kind !== type || input.lifecycle !== 'active')
          throw new TypeError('Canonical entity identity, kind or lifecycle is invalid.');
        const lifetime = identities.get(input.id);
        if (lifetime === undefined || !issued.has(input.id))
          throw new TypeError('Canonical entity identity metadata is missing.');
        const created = candidateOwner.createRestored(this.prepareEntity(input, input.id, type), lifetime);
        this.addToBucket(created, candidateBuckets);
      }
      if (identities.size !== snapshot.entities.length)
        throw new TypeError('Entity identity snapshot set does not match canonical entities.');
      const actorEntityIds = candidateOwner
        .query()
        .filter((entity) => entity.type !== 'world-item')
        .map((entity) => entity.id);
      if (actorSnapshots.size !== actorEntityIds.length)
        throw new TypeError('Actor component snapshot set does not match canonical entities.');
      for (const entityId of actorEntityIds) {
        const actor = actorSnapshots.get(entityId);
        if (!actor) throw new TypeError(`Actor component snapshot is missing: ${entityId}`);
        candidateOwner.restoreActorComponentSnapshot(actor);
      }
      candidateOwner.setLifetimeHighWater(Math.max(snapshot.lifetimeHighWater, this.owner.lifetimeHighWater));
      candidateOwner.reserveIssued([...issued, ...this.owner.issuedIds()]);
    } catch (error) {
      candidateOwner.dispose();
      throw error;
    }

    const previous = this.owner;
    this.owner = candidateOwner;
    this.buckets = candidateBuckets;
    this.sequence = Math.max(snapshot.sequence, this.sequence);
    previous.dispose();
  }

  restore(entities: readonly EntitySpawn[], sequence = 0): void {
    if (!Number.isSafeInteger(sequence) || sequence < 0)
      throw new TypeError('Entity sequence must be a non-negative safe integer.');
    if (this.owner.epoch >= Number.MAX_SAFE_INTEGER) throw new RangeError('Entity world epoch is exhausted.');
    const explicitIds = new Set<string>();
    for (const input of entities) {
      if (input.id === undefined) continue;
      if (explicitIds.has(input.id)) throw new Error(`Entity already exists: ${input.id}`);
      explicitIds.add(input.id);
    }
    const blockedGeneratedIds = new Set([...this.owner.issuedIds(), ...explicitIds]);
    const candidateOwner = new EcsEntityOwner(this.owner.epoch + 1);
    const candidateBuckets = new Map<string, Set<string>>();
    let candidateSequence = sequence;
    try {
      for (const input of entities) {
        const type = this.entityType(input);
        const { id, sequence: nextSequence } = this.identityFor(
          candidateOwner,
          input,
          type,
          candidateSequence,
          blockedGeneratedIds,
        );
        if (!id.trim()) throw new TypeError('Entity id must not be empty.');
        if (candidateOwner.get(id)) throw new Error(`Entity already exists: ${id}`);
        const entity = this.prepareEntity(input, id, type);
        const created = candidateOwner.create(entity);
        this.addToBucket(created, candidateBuckets);
        candidateSequence = nextSequence;
      }
    } catch (error) {
      candidateOwner.dispose();
      throw error;
    }
    candidateOwner.reserveIssued(this.owner.issuedIds());
    const previous = this.owner;
    this.owner = candidateOwner;
    this.buckets = candidateBuckets;
    this.sequence = Math.max(candidateSequence, sequence);
    previous.dispose();
  }

  actorStateAccess(id: string) {
    return this.owner.actorStateAccess(id);
  }

  playerStateAccess(id: string) {
    return this.owner.playerStateAccess(id);
  }

  createReference(id: string): EntityLifetimeReference | null {
    return this.owner.createReference(id);
  }

  resolveReference(reference: EntityLifetimeReference): GameplayEntity | null {
    return this.owner.resolveReference(reference);
  }

  dispose(): void {
    this.owner.dispose();
    this.buckets.clear();
  }

  get nextSequence(): number {
    return this.sequence;
  }

  private prepareEntity(input: EntitySpawn, id: string, type: EntityType): GameplayEntity {
    this.assertPosition(input.position);
    const entity: GameplayEntity = { id, type, kind: type, lifecycle: 'active', position: [...input.position] };
    if (input.physicsVelocity) {
      this.assertPosition(input.physicsVelocity);
      entity.physicsVelocity = [...input.physicsVelocity];
    } else if (type !== 'player') entity.physicsVelocity = [0, 0, 0];
    if (type === 'world-item') {
      if (!input.stack) throw new TypeError('World item entity requires an item stack.');
      assertItemStack(input.stack);
      entity.stack = { ...input.stack };
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
      const archetype = input.archetype ?? (type === 'creature' ? 'grazer' : undefined);
      if (archetype) {
        if (!['grazer', 'night-stalker', 'settler'].includes(archetype))
          throw new TypeError(`Unsupported actor archetype: ${String(archetype)}`);
        if ((type === 'npc') !== (archetype === 'settler'))
          throw new TypeError('Settlers must be NPC entities and creature archetypes must be creatures.');
        entity.archetype = archetype;
        entity.persistent = input.persistent ?? true;
      }
    }
    return entity;
  }

  private entityType(input: EntitySpawn): EntityType {
    const type = input.type ?? input.kind;
    if (type !== 'player' && type !== 'world-item' && type !== 'creature' && type !== 'npc')
      throw new TypeError(`Unsupported entity type: ${String(type)}`);
    return type;
  }

  private identityFor(
    owner: EcsEntityOwner,
    input: EntitySpawn,
    type: EntityType,
    sequence: number,
    blockedGeneratedIds: ReadonlySet<string> = new Set(),
  ): { id: string; sequence: number } {
    if (input.id !== undefined) return { id: input.id, sequence };
    let nextSequence = sequence;
    let id: string;
    do {
      nextSequence += 1;
      if (!Number.isSafeInteger(nextSequence)) throw new RangeError('Entity sequence is exhausted.');
      id = `${type}-${nextSequence}`;
    } while (owner.isIssued(id) || blockedGeneratedIds.has(id));
    return { id, sequence: nextSequence };
  }

  private addToBucket(entity: GameplayEntity, buckets: Map<string, Set<string>>): void {
    const key = bucketKey(entity.position);
    const bucket = buckets.get(key) ?? new Set<string>();
    bucket.add(entity.id);
    buckets.set(key, bucket);
  }

  private removeFromBucket(entity: GameplayEntity, buckets: Map<string, Set<string>>): void {
    const key = bucketKey(entity.position);
    const bucket = buckets.get(key);
    bucket?.delete(entity.id);
    if (bucket?.size === 0) buckets.delete(key);
  }

  private moveEntity(entity: GameplayEntity, position: readonly [number, number, number]): void {
    this.assertPosition(position);
    this.removeFromBucket(entity, this.buckets);
    this.owner.setPosition(entity.id, [...position]);
    this.addToBucket(this.owner.get(entity.id)!, this.buckets);
  }

  private assertPosition(position: readonly number[]): asserts position is Position {
    if (position.length !== 3 || !position.every(Number.isFinite))
      throw new TypeError('Entity position must contain three finite numbers.');
  }
}
