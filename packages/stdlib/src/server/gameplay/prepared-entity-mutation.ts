import type { ActorComponentSnapshot } from './ecs-actor-components';
import { isActorEntityType } from './ecs-actor-state';
import type { EcsEntityOwner, EcsPosition, EntityLifetimeReference } from './ecs-entity-owner';
import type { StationComponentV1, StationKind } from './ecs-station-state';
import type { EntitySpawn, EntityStore, GameplayEntity } from './entity-store';
import type { ItemStack } from './item-registry';

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
  removeFromBucket(entity: GameplayEntity): void;
  addToBucket(entity: GameplayEntity): void;
  commitSequence(sequence: number): void;
}>;

const sameSnapshot = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function copyPosition(value: readonly number[] | undefined, field: string): EcsPosition | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError(`Prepared entity ${field} is invalid.`);
  assertDense(value);
  const copy = [...value];
  if (!copy.every(Number.isFinite)) throw new TypeError(`Prepared entity ${field} is invalid.`);
  return copy as EcsPosition;
}

function prepareMutation(
  host: PreparedEntityMutationHost,
  input: PreparedEntityMutationInput,
  maxEntries: number,
): PreparedEntityMutation {
  if (!input || typeof input !== 'object') throw new TypeError('Prepared entity mutation input is invalid.');
  const actorInputs = input.actors ?? [];
  const dynamicInputs = input.dynamics ?? [];
  const stationInputs = input.stations ?? [];
  const worldItemInputs = input.worldItems ?? [];
  const spawnInputs = input.spawns ?? [];
  const stationSpawnInputs = input.stationSpawns ?? [];
  const despawnInputs = input.despawns ?? [];
  for (const entries of [
    dynamicInputs,
    actorInputs,
    stationInputs,
    worldItemInputs,
    spawnInputs,
    stationSpawnInputs,
    despawnInputs,
  ])
    if (!Array.isArray(entries)) throw new TypeError('Prepared entity mutation entries must be arrays.');
  const entryCount =
    dynamicInputs.length +
    actorInputs.length +
    stationInputs.length +
    worldItemInputs.length +
    spawnInputs.length +
    stationSpawnInputs.length +
    despawnInputs.length;
  if (!Number.isSafeInteger(entryCount) || entryCount < 1 || entryCount > maxEntries)
    throw new RangeError(`Prepared entity mutation must contain between 1 and ${maxEntries} entries.`);
  for (const entries of [
    dynamicInputs,
    actorInputs,
    stationInputs,
    worldItemInputs,
    spawnInputs,
    stationSpawnInputs,
    despawnInputs,
  ])
    assertDense(entries);

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
      station: StationComponentV1 | null;
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
    const actor = isActorEntityType(entity.type) ? capturedOwner.actorComponentSnapshot(entity.id) : null;
    const station = entity.type === 'station' ? capturedOwner.stationSnapshot(entity.id) : null;
    touched.set(entity.id, Object.freeze({ reference: savedReference, entity, actor, station }));
    return entity;
  };

  const actors = actorInputs.map((candidate) => {
    const entity = capture(candidate.reference, 'actor');
    if (!isActorEntityType(entity.type) || entity.health === undefined || entity.maxHealth === undefined)
      throw new TypeError(`Prepared actor replacement requires an actor: ${entity.id}`);
    if (candidate.components?.entityId !== entity.id)
      throw new TypeError('Prepared actor component identity does not match its reference.');
    if (!Number.isFinite(candidate.health) || candidate.health < 0 || candidate.health > entity.maxHealth)
      throw new TypeError('Prepared actor health is invalid.');
    if ((candidate.health === 0) !== (candidate.components.lifecycle === 'dead'))
      throw new TypeError('Prepared actor health and lifecycle do not match.');
    const previous = capturedOwner.actorComponentSnapshot(entity.id);
    const interactionChanged = !sameSnapshot(
      [previous.inventory, previous.inventoryCursor],
      [candidate.components.inventory, candidate.components.inventoryCursor],
    );
    const previousInventoryRevision = previous.inventoryRevision ?? 0;
    if (interactionChanged && previousInventoryRevision >= Number.MAX_SAFE_INTEGER)
      throw new RangeError('Actor inventory revision is exhausted.');
    const components: ActorComponentSnapshot = {
      ...candidate.components,
      inventoryRevision: previousInventoryRevision + Number(interactionChanged),
    };
    return Object.freeze({
      id: entity.id,
      entity,
      health: candidate.health,
      components: capturedOwner.prepareActorComponentSnapshot(entity.id, components),
      position: copyPosition(candidate.position, 'position'),
      physicsVelocity: copyPosition(candidate.physicsVelocity, 'physics velocity'),
    });
  });

  const dynamics = dynamicInputs.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') throw new TypeError('Prepared dynamic replacement is invalid.');
    const entity = capture(candidate.reference, 'dynamic');
    if (entity.type === 'station') throw new TypeError('Prepared dynamic replacement cannot update a station.');
    const position = copyPosition(candidate.position, 'position');
    const physicsVelocity = copyPosition(candidate.physicsVelocity, 'physics velocity');
    if (!position && !physicsVelocity) throw new TypeError('Prepared dynamic replacement requires a spatial field.');
    return Object.freeze({ id: entity.id, entity, position, physicsVelocity });
  });

  const stations = stationInputs.map((candidate) => {
    const entity = capture(candidate.reference, 'station');
    if (entity.type !== 'station') throw new TypeError(`Prepared station replacement requires a station: ${entity.id}`);
    const current = capturedOwner.stationSnapshot(entity.id);
    if (current.revision >= Number.MAX_SAFE_INTEGER || candidate.snapshot?.revision !== current.revision + 1)
      throw new TypeError('Prepared station revision must advance exactly once.');
    return Object.freeze({
      id: entity.id,
      snapshot: capturedOwner.prepareStationComponentSnapshot(entity.id, candidate.snapshot),
    });
  });

  const worldItems = worldItemInputs.map((candidate) => {
    const entity = capture(candidate.reference, 'world-item');
    if (entity.type !== 'world-item' || !entity.stack || !Number.isSafeInteger(candidate.count) || candidate.count <= 0)
      throw new TypeError('Prepared world-item count is invalid.');
    host.prepareWorldItem(
      { type: 'world-item', position: entity.position, stack: { ...entity.stack, count: candidate.count } },
      entity.id,
    );
    return Object.freeze({ id: entity.id, count: candidate.count });
  });

  const despawns = despawnInputs.map((reference) => {
    const entity = capture(reference, 'despawn');
    return Object.freeze({ id: entity.id, entity });
  });

  const explicitSpawnIds = new Set<string>();
  for (const spawn of [...spawnInputs, ...stationSpawnInputs]) {
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

  const despawnedStationIds = new Set(
    despawns.filter((candidate) => candidate.entity.type === 'station').map((candidate) => candidate.id),
  );
  const occupiedStationPositions = new Set(
    capturedOwner
      .queryStations()
      .filter((station) => !despawnedStationIds.has(station.id))
      .map((station) => station.position.join(',')),
  );
  const stationSpawns = stationSpawnInputs.map((spawn) => {
    let id = spawn.id;
    if (id === undefined) {
      do {
        candidateSequence += 1;
        if (!Number.isSafeInteger(candidateSequence)) throw new RangeError('Entity sequence is exhausted.');
        id = `station-${candidateSequence}`;
      } while (capturedOwner.isIssued(id) || blockedSpawnIds.has(id));
    }
    if (!id.trim()) throw new TypeError('Entity id must not be empty.');
    if (capturedOwner.get(id)) throw new Error(`Entity already exists: ${id}`);
    if (capturedOwner.isIssued(id)) throw new Error(`Entity id was already issued or retired: ${id}`);
    if (touchedIds.has(id) || (spawn.id === undefined && explicitSpawnIds.has(id)))
      throw new TypeError(`Prepared entity mutation contains a duplicate or conflicting id: ${id}`);
    blockedSpawnIds.add(id);
    const position = copyPosition(spawn.position, 'station position')!;
    if (!position.every(Number.isSafeInteger))
      throw new TypeError('Prepared station position must contain safe integers.');
    const positionKey = position.join(',');
    if (occupiedStationPositions.has(positionKey)) throw new Error('Prepared station position is already occupied.');
    occupiedStationPositions.add(positionKey);
    const prepared = host.prepareStation({ position, kind: spawn.kind }, id);
    return Object.freeze(prepared);
  });
  const allSpawns = [...spawns.map((entity) => Object.freeze({ entity, station: null })), ...stationSpawns];
  capturedOwner.validateCreateCapacity(allSpawns.length);

  const spawnIds = Object.freeze(allSpawns.map((spawn) => spawn.entity.id));
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
    capturedOwner.validateCreateCapacity(allSpawns.length);
    for (const saved of touched.values()) {
      const entity = capturedOwner.resolveReference(saved.reference);
      if (!entity || !sameSnapshot(entity, saved.entity))
        throw new Error(`Prepared entity mutation touched entity is stale: ${saved.reference.entityId}`);
      if (saved.actor && !sameSnapshot(capturedOwner.actorComponentSnapshot(saved.reference.entityId), saved.actor))
        throw new Error(`Prepared entity mutation actor component state has changed: ${saved.reference.entityId}`);
      if (saved.station && !sameSnapshot(capturedOwner.stationSnapshot(saved.reference.entityId), saved.station))
        throw new Error(`Prepared entity mutation station component state has changed: ${saved.reference.entityId}`);
    }
    for (const id of spawnIds)
      if (capturedOwner.get(id) || capturedOwner.isIssued(id))
        throw new Error(`Prepared entity mutation spawn id is stale: ${id}`);
    for (const spawn of stationSpawns) {
      const occupant = capturedOwner.stationAt(spawn.entity.position);
      if (occupant && !despawnedStationIds.has(occupant.id))
        throw new Error(`Prepared station position is stale or occupied: ${spawn.entity.id}`);
    }
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

      for (const dynamic of dynamics) {
        if (dynamic.position) host.removeFromBucket(dynamic.entity);
        if (dynamic.position) capturedOwner.setPosition(dynamic.id, dynamic.position);
        if (dynamic.physicsVelocity) capturedOwner.setVelocity(dynamic.id, dynamic.physicsVelocity);
        if (dynamic.position) host.addToBucket(capturedOwner.get(dynamic.id)!);
      }
      for (const actor of actors) {
        if (actor.position) host.removeFromBucket(actor.entity);
        capturedOwner.installPreparedActorReplacement(actor.id, actor.health, actor.components, {
          ...(actor.position ? { position: actor.position } : {}),
          ...(actor.physicsVelocity ? { physicsVelocity: actor.physicsVelocity } : {}),
        });
        if (actor.position) host.addToBucket(capturedOwner.get(actor.id)!);
      }
      for (const station of stations) capturedOwner.installPreparedStationReplacement(station.id, station.snapshot);
      for (const item of worldItems) capturedOwner.setStackCount(item.id, item.count);
      for (const despawn of despawns) {
        host.removeFromBucket(despawn.entity);
        capturedOwner.destroy(despawn.id);
      }
      const spawned = allSpawns.map((spawn) => {
        const created = spawn.station
          ? capturedOwner.createPreparedStation(spawn.entity, spawn.station)
          : capturedOwner.createPreparedWorldItem(spawn.entity);
        host.addToBucket(created);
        return created;
      });
      host.commitSequence(candidateSequence);
      return Object.freeze({
        actorIds: Object.freeze(actors.map((actor) => actor.id)),
        stationIds: Object.freeze(stations.map((station) => station.id)),
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
  const dynamics: NonNullable<PreparedEntityMutationInput['dynamics']>[number][] = [],
    actors: PreparedActorReplacement[] = [],
    stations: PreparedStationReplacement[] = [],
    worldItems: Readonly<{ reference: EntityLifetimeReference; count: number }>[] = [],
    spawns: PreparedWorldItemSpawn[] = [],
    stationSpawns: PreparedStationSpawn[] = [],
    despawns: EntityLifetimeReference[] = [];
  for (const segment of segments) {
    if (!segment || typeof segment !== 'object') throw new TypeError('Entity mutation segment is invalid.');
    const actorEntries = segment.actors ?? [],
      dynamicEntries = segment.dynamics ?? [],
      stationEntries = segment.stations ?? [],
      worldItemEntries = segment.worldItems ?? [],
      spawnEntries = segment.spawns ?? [],
      stationSpawnEntries = segment.stationSpawns ?? [],
      despawnEntries = segment.despawns ?? [];
    for (const entries of [
      dynamicEntries,
      actorEntries,
      stationEntries,
      worldItemEntries,
      spawnEntries,
      stationSpawnEntries,
      despawnEntries,
    ])
      if (!Array.isArray(entries)) throw new TypeError('Entity mutation segment arrays are invalid.');
    const count =
      dynamicEntries.length +
      actorEntries.length +
      stationEntries.length +
      worldItemEntries.length +
      spawnEntries.length +
      stationSpawnEntries.length +
      despawnEntries.length;
    if (count < 1 || count > 128) throw new RangeError('Entity mutation segment must contain 1..128 entries.');
    for (const entries of [
      dynamicEntries,
      actorEntries,
      stationEntries,
      worldItemEntries,
      spawnEntries,
      stationSpawnEntries,
      despawnEntries,
    ])
      assertDense(entries);
    dynamics.push(...dynamicEntries);
    actors.push(...actorEntries);
    stations.push(...stationEntries);
    worldItems.push(...worldItemEntries);
    spawns.push(...spawnEntries);
    stationSpawns.push(...stationSpawnEntries);
    despawns.push(...despawnEntries);
  }
  return prepareMutation(host, { dynamics, actors, stations, worldItems, spawns, stationSpawns, despawns }, 192 * 128);
}

/** All segments share one allocator reservation and one commit frontier. */
export function prepareEntityMutationSeries(
  store: EntityStore,
  segments: readonly PreparedEntityMutationInput[],
): PreparedEntityMutation {
  return store.prepareMutationSeries(segments);
}
