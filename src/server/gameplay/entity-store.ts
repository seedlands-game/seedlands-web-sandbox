import { assertItemStack, type ItemStack } from './item-registry';

export type EntityType = 'player' | 'world-item' | 'creature' | 'npc';
export type ActorArchetype = 'grazer' | 'night-stalker' | 'settler';
export type EntityLifecycle = 'active' | 'despawned';
type Position = [number, number, number];

export type GameplayEntity = {
  id: string;
  type: EntityType;
  kind: EntityType;
  lifecycle: EntityLifecycle;
  position: Position;
  physicsVelocity?: Position;
  stack?: ItemStack;
  health?: number;
  maxHealth?: number;
  archetype?: ActorArchetype;
  persistent?: boolean;
};

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

const clone = (entity: GameplayEntity): GameplayEntity => ({
  ...entity,
  position: [...entity.position],
  ...(entity.physicsVelocity ? { physicsVelocity: [...entity.physicsVelocity] } : {}),
  ...(entity.stack ? { stack: { ...entity.stack } } : {}),
});

const bucketCoordinate = (value: number) => Math.floor(value / 8);
const bucketKey = (position: readonly number[]) => position.map(bucketCoordinate).join(',');

export class EntityStore {
  private readonly entities = new Map<string, GameplayEntity>();
  private readonly buckets = new Map<string, Set<string>>();
  private sequence = 0;
  private visitedBucketCount = 0;
  private visitedEntityCount = 0;
  private returnedEntityCount = 0;

  spawn(input: EntitySpawn): GameplayEntity {
    const type = input.type ?? input.kind;
    if (type !== 'player' && type !== 'world-item' && type !== 'creature' && type !== 'npc')
      throw new TypeError(`Unsupported entity type: ${String(type)}`);
    this.assertPosition(input.position);
    const id = input.id ?? `${type}-${++this.sequence}`;
    if (!id.trim()) throw new TypeError('Entity id must not be empty.');
    if (this.entities.has(id)) throw new Error(`Entity already exists: ${id}`);
    const entity: GameplayEntity = {
      id,
      type,
      kind: type,
      lifecycle: 'active',
      position: [...input.position],
    };
    if (input.physicsVelocity) {
      this.assertPosition(input.physicsVelocity);
      entity.physicsVelocity = [...input.physicsVelocity];
    } else if (type !== 'player') entity.physicsVelocity = [0, 0, 0];
    if (type === 'world-item') {
      if (!input.stack) throw new TypeError('World item entity requires an item stack.');
      assertItemStack(input.stack);
      entity.stack = { ...input.stack };
    }
    if (type === 'creature' || type === 'npc') {
      const maxHealth = input.maxHealth ?? 12;
      const health = input.health ?? maxHealth;
      if (!Number.isFinite(maxHealth) || maxHealth <= 0 || !Number.isFinite(health) || health < 0 || health > maxHealth)
        throw new TypeError('Creature health must be finite and within its maximum.');
      entity.health = health;
      entity.maxHealth = maxHealth;
      if (input.archetype) {
        if (!['grazer', 'night-stalker', 'settler'].includes(input.archetype))
          throw new TypeError(`Unsupported actor archetype: ${String(input.archetype)}`);
        if ((type === 'npc') !== (input.archetype === 'settler'))
          throw new TypeError('Settlers must be NPC entities and creature archetypes must be creatures.');
        entity.archetype = input.archetype;
        entity.persistent = input.persistent ?? true;
      }
    }
    this.entities.set(id, entity);
    this.addToBucket(entity);
    return clone(entity);
  }

  get(id: string): GameplayEntity | null {
    const entity = this.entities.get(id);
    return entity ? clone(entity) : null;
  }

  update(id: string, update: EntityUpdate): GameplayEntity {
    const entity = this.entities.get(id);
    if (!entity) throw new Error(`Unknown entity: ${id}`);
    if (update.position) this.move(id, update.position);
    if (update.physicsVelocity) {
      this.assertPosition(update.physicsVelocity);
      entity.physicsVelocity = [...update.physicsVelocity];
    }
    if (update.health !== undefined) {
      if (
        (entity.type !== 'creature' && entity.type !== 'npc') ||
        !Number.isFinite(update.health) ||
        update.health < 0 ||
        update.health > entity.maxHealth!
      )
        throw new TypeError('Entity health update is invalid.');
      entity.health = update.health;
    }
    return clone(this.entities.get(id)!);
  }

  move(id: string, position: readonly [number, number, number]): GameplayEntity {
    const entity = this.entities.get(id);
    if (!entity) throw new Error(`Unknown entity: ${id}`);
    this.assertPosition(position);
    this.removeFromBucket(entity);
    entity.position = [...position];
    this.addToBucket(entity);
    return clone(entity);
  }

  despawn(id: string): boolean {
    const entity = this.entities.get(id);
    if (!entity) return false;
    this.removeFromBucket(entity);
    entity.lifecycle = 'despawned';
    this.entities.delete(id);
    return true;
  }

  consumeWorldItemUnit(id: string): { itemId: string; remainingCount: number } | null {
    const entity = this.entities.get(id);
    if (!entity?.stack || entity.type !== 'world-item') return null;
    const itemId = entity.stack.itemId;
    entity.stack.count -= 1;
    const remainingCount = entity.stack.count;
    if (remainingCount === 0) this.despawn(id);
    return { itemId, remainingCount };
  }

  query(filter: EntityQuery = {}): GameplayEntity[] {
    return [...this.entities.values()].filter((entity) => !filter.type || entity.type === filter.type).map(clone);
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
      .map((id) => this.entities.get(id)!)
      .filter(
        (entity) =>
          (!filter.type || entity.type === filter.type) &&
          entity.position.reduce((sum, value, index) => sum + (value - position[index]) ** 2, 0) <= radiusSquared,
      )
      .map(clone);
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
    return this.query();
  }

  restore(entities: readonly EntitySpawn[], sequence = 0): void {
    this.entities.clear();
    this.buckets.clear();
    this.sequence = sequence;
    entities.forEach((entity) => this.spawn(entity));
    this.sequence = Math.max(this.sequence, sequence);
  }

  get nextSequence(): number {
    return this.sequence;
  }

  private addToBucket(entity: GameplayEntity): void {
    const key = bucketKey(entity.position);
    const bucket = this.buckets.get(key) ?? new Set<string>();
    bucket.add(entity.id);
    this.buckets.set(key, bucket);
  }

  private removeFromBucket(entity: GameplayEntity): void {
    const key = bucketKey(entity.position);
    const bucket = this.buckets.get(key);
    bucket?.delete(entity.id);
    if (bucket?.size === 0) this.buckets.delete(key);
  }

  private assertPosition(position: readonly number[]): asserts position is Position {
    if (position.length !== 3 || !position.every(Number.isFinite))
      throw new TypeError('Entity position must contain three finite numbers.');
  }
}
