import type { ActorComponentSnapshot } from './ecs-actor-components';
import type { EcsEntityOwner, EntityLifetimeReference } from './ecs-entity-owner';
import type { EntitySpawn, EntityStore, GameplayEntity } from './entity-store';
import type { ItemStack } from './item-registry';

export type PreparedActorReplacement = Readonly<{
  reference: EntityLifetimeReference;
  health: number;
  components: ActorComponentSnapshot;
}>;

export type PreparedWorldItemSpawn = Readonly<{
  id?: string;
  position: readonly [number, number, number];
  physicsVelocity?: readonly [number, number, number];
  stack: ItemStack;
}>;

export type PreparedEntityMutationInput = Readonly<{
  actors?: readonly PreparedActorReplacement[];
  spawns?: readonly PreparedWorldItemSpawn[];
  despawns?: readonly EntityLifetimeReference[];
}>;

export type PreparedEntityMutationResult = Readonly<{
  actorIds: readonly string[];
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
  removeFromBucket(entity: GameplayEntity): void;
  addToBucket(entity: GameplayEntity): void;
  commitSequence(sequence: number): void;
}>;

const sameSnapshot = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function prepareMutation(
  host: PreparedEntityMutationHost,
  input: PreparedEntityMutationInput,
  maxEntries: number,
): PreparedEntityMutation {
  if (!input || typeof input !== 'object') throw new TypeError('Prepared entity mutation input is invalid.');
  const actorInputs = input.actors ?? [];
  const spawnInputs = input.spawns ?? [];
  const despawnInputs = input.despawns ?? [];
  for (const entries of [actorInputs, spawnInputs, despawnInputs])
    if (!Array.isArray(entries)) throw new TypeError('Prepared entity mutation entries must be arrays.');
  const entryCount = actorInputs.length + spawnInputs.length + despawnInputs.length;
  if (!Number.isSafeInteger(entryCount) || entryCount < 1 || entryCount > maxEntries)
    throw new RangeError(`Prepared entity mutation must contain between 1 and ${maxEntries} entries.`);
  for (const entries of [actorInputs, spawnInputs, despawnInputs]) assertDense(entries);

  const capturedOwner = host.owner;
  const capturedEpoch = capturedOwner.epoch;
  const capturedSequence = host.sequence;
  const capturedLifetimeHighWater = capturedOwner.lifetimeHighWater;
  const capturedOrderHighWater = capturedOwner.orderHighWater;
  const touchedIds = new Set<string>();
  const touched = new Map<
    string,
    Readonly<{
      reference: EntityLifetimeReference;
      entity: GameplayEntity;
      actor: ActorComponentSnapshot | null;
    }>
  >();

  const capture = (reference: EntityLifetimeReference, category: string) => {
    if (
      !reference ||
      typeof reference.entityId !== 'string' ||
      !reference.entityId.trim() ||
      !Number.isSafeInteger(reference.epoch) ||
      reference.epoch <= 0 ||
      !Number.isSafeInteger(reference.lifetime) ||
      reference.lifetime <= 0
    )
      throw new TypeError(`Prepared ${category} entity reference is invalid.`);
    if (touchedIds.has(reference.entityId))
      throw new TypeError(`Prepared entity mutation contains a duplicate or conflicting id: ${reference.entityId}`);
    const entity = capturedOwner.resolveReference(reference);
    if (!entity) throw new Error(`Prepared ${category} entity reference is stale: ${reference.entityId}`);
    touchedIds.add(reference.entityId);
    const savedReference = Object.freeze({ ...reference });
    const actor = entity.type === 'world-item' ? null : capturedOwner.actorComponentSnapshot(entity.id);
    touched.set(entity.id, Object.freeze({ reference: savedReference, entity, actor }));
    return entity;
  };

  const actors = actorInputs.map((candidate) => {
    const entity = capture(candidate.reference, 'actor');
    if (entity.type === 'world-item' || entity.health === undefined || entity.maxHealth === undefined)
      throw new TypeError(`Prepared actor replacement requires an actor: ${entity.id}`);
    if (candidate.components?.entityId !== entity.id)
      throw new TypeError('Prepared actor component identity does not match its reference.');
    if (!Number.isFinite(candidate.health) || candidate.health < 0 || candidate.health > entity.maxHealth)
      throw new TypeError('Prepared actor health is invalid.');
    if ((candidate.health === 0) !== (candidate.components.lifecycle === 'dead'))
      throw new TypeError('Prepared actor health and lifecycle do not match.');
    return Object.freeze({
      id: entity.id,
      health: candidate.health,
      components: capturedOwner.prepareActorComponentSnapshot(entity.id, candidate.components),
    });
  });

  const despawns = despawnInputs.map((reference) => {
    const entity = capture(reference, 'despawn');
    return Object.freeze({ id: entity.id, entity });
  });

  const explicitSpawnIds = new Set<string>();
  for (const spawn of spawnInputs) {
    if (spawn.id === undefined) continue;
    if (typeof spawn.id !== 'string' || !spawn.id.trim()) throw new TypeError('Entity id must not be empty.');
    if (explicitSpawnIds.has(spawn.id) || touchedIds.has(spawn.id))
      throw new TypeError(`Prepared entity mutation contains a duplicate or conflicting id: ${spawn.id}`);
    explicitSpawnIds.add(spawn.id);
  }
  const blockedSpawnIds = new Set([...explicitSpawnIds, ...touchedIds]);
  let candidateSequence = capturedSequence;
  const spawns = spawnInputs.map((spawn) => {
    let id = spawn.id;
    if (id === undefined) {
      do {
        candidateSequence += 1;
        if (!Number.isSafeInteger(candidateSequence)) throw new RangeError('Entity sequence is exhausted.');
        id = `world-item-${candidateSequence}`;
      } while (capturedOwner.isIssued(id) || blockedSpawnIds.has(id));
    }
    if (!id.trim()) throw new TypeError('Entity id must not be empty.');
    if (capturedOwner.get(id)) throw new Error(`Entity already exists: ${id}`);
    if (capturedOwner.isIssued(id)) throw new Error(`Entity id was already issued or retired: ${id}`);
    if (touchedIds.has(id) || (spawn.id === undefined && explicitSpawnIds.has(id)))
      throw new TypeError(`Prepared entity mutation contains a duplicate or conflicting id: ${id}`);
    blockedSpawnIds.add(id);
    const entity = host.prepareWorldItem({ ...spawn, type: 'world-item', kind: 'world-item' }, id);
    return Object.freeze(entity);
  });
  capturedOwner.validateCreateCapacity(spawns.length);

  const spawnIds = Object.freeze(spawns.map((spawn) => spawn.id));
  let state: 'open' | 'validated' | 'used' = 'open';
  const assertFresh = () => {
    if (!host.isCurrent(capturedOwner, capturedSequence))
      throw new Error('Prepared entity mutation owner, epoch or sequence is stale.');
    if (capturedOwner.epoch !== capturedEpoch) throw new Error('Prepared entity mutation epoch is stale.');
    if (
      capturedOwner.lifetimeHighWater !== capturedLifetimeHighWater ||
      capturedOwner.orderHighWater !== capturedOrderHighWater
    )
      throw new Error('Prepared entity mutation allocator state has changed.');
    capturedOwner.validateCreateCapacity(spawns.length);
    for (const saved of touched.values()) {
      const entity = capturedOwner.resolveReference(saved.reference);
      if (!entity || !sameSnapshot(entity, saved.entity))
        throw new Error(`Prepared entity mutation touched entity is stale: ${saved.reference.entityId}`);
      if (saved.actor && !sameSnapshot(capturedOwner.actorComponentSnapshot(saved.reference.entityId), saved.actor))
        throw new Error(`Prepared entity mutation actor component state has changed: ${saved.reference.entityId}`);
    }
    for (const id of spawnIds)
      if (capturedOwner.get(id) || capturedOwner.isIssued(id))
        throw new Error(`Prepared entity mutation spawn id is stale: ${id}`);
  };

  return Object.freeze({
    spawnIds,
    validate: () => {
      if (state === 'used') throw new Error('Prepared entity mutation was already used or applied.');
      assertFresh();
      state = 'validated';
    },
    apply: (): PreparedEntityMutationResult => {
      if (state === 'open') throw new Error('Prepared entity mutation must validate before apply.');
      if (state === 'used') throw new Error('Prepared entity mutation was already used or applied.');
      state = 'used';
      assertFresh();

      for (const actor of actors)
        capturedOwner.installPreparedActorReplacement(actor.id, actor.health, actor.components);
      for (const despawn of despawns) {
        host.removeFromBucket(despawn.entity);
        capturedOwner.destroy(despawn.id);
      }
      const spawned = spawns.map((spawn) => {
        const created = capturedOwner.createPreparedWorldItem(spawn);
        host.addToBucket(created);
        return created;
      });
      host.commitSequence(candidateSequence);
      return Object.freeze({
        actorIds: Object.freeze(actors.map((actor) => actor.id)),
        despawnedIds: Object.freeze(despawns.map((despawn) => despawn.id)),
        spawned: Object.freeze(spawned),
      });
    },
  });
}

/** Host-only entry point. Product composition owns coordination with other prepared participants. */
export function prepareEntityMutation(store: EntityStore, input: PreparedEntityMutationInput): PreparedEntityMutation {
  return store.prepareMutation(input);
}

function assertDense(entries: readonly unknown[]): void {
  if (!Array.isArray(entries)) throw new TypeError('Prepared entity mutation entries must be arrays.');
  for (let index = 0; index < entries.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(entries, index);
    if (!descriptor || !('value' in descriptor))
      throw new TypeError('Prepared entity mutation arrays must be dense data.');
  }
}

export function prepareEntityMutationParticipant(
  host: PreparedEntityMutationHost,
  input: PreparedEntityMutationInput,
): PreparedEntityMutation {
  return prepareMutation(host, input, 128);
}

export function prepareEntityMutationSeriesParticipant(
  host: PreparedEntityMutationHost,
  segments: readonly PreparedEntityMutationInput[],
): PreparedEntityMutation {
  if (!Array.isArray(segments) || segments.length < 1 || segments.length > 192)
    throw new RangeError('Entity mutation series must contain 1..192 segments.');
  assertDense(segments);
  const actors: PreparedActorReplacement[] = [],
    spawns: PreparedWorldItemSpawn[] = [],
    despawns: EntityLifetimeReference[] = [];
  for (const segment of segments) {
    if (!segment || typeof segment !== 'object') throw new TypeError('Entity mutation segment is invalid.');
    const actorEntries = segment.actors ?? [],
      spawnEntries = segment.spawns ?? [],
      despawnEntries = segment.despawns ?? [];
    for (const entries of [actorEntries, spawnEntries, despawnEntries])
      if (!Array.isArray(entries)) throw new TypeError('Entity mutation segment arrays are invalid.');
    const count = actorEntries.length + spawnEntries.length + despawnEntries.length;
    if (count < 1 || count > 128) throw new RangeError('Entity mutation segment must contain 1..128 entries.');
    for (const entries of [actorEntries, spawnEntries, despawnEntries]) assertDense(entries);
    actors.push(...actorEntries);
    spawns.push(...spawnEntries);
    despawns.push(...despawnEntries);
  }
  return prepareMutation(host, { actors, spawns, despawns }, 192 * 128);
}

/** All segments share one allocator reservation and one commit frontier. */
export function prepareEntityMutationSeries(
  store: EntityStore,
  segments: readonly PreparedEntityMutationInput[],
): PreparedEntityMutation {
  return store.prepareMutationSeries(segments);
}
