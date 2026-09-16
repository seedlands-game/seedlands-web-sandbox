import type {
  FrozenKernelDefinitions,
  KernelCheckpointV1,
  KernelComponentDefinition,
  KernelComponentStorage,
  KernelEntityReference,
  KernelEvent,
  KernelSystemContext,
  KernelValue,
  KernelWorldIdentity,
} from '../registry/contracts';
import { createKernelRuntime } from '../execution/kernel-runtime';
import { cloneKernelValue } from '../registry/clone-value';

type EntityState = { lifetime: number };
type EntityDirectory = Readonly<{
  depth: number;
  base?: ReadonlyMap<string, EntityState>;
  parent?: EntityDirectory;
  added: ReadonlyMap<string, EntityState>;
  removed: ReadonlySet<string>;
}>;
type MutableState = {
  entities: EntityDirectory;
  components: Map<string, KernelComponentStorage<unknown>>;
};

const REMOVED = Symbol('removed');
type CandidateState = {
  addedEntities: Map<string, EntityState>;
  removedEntities: Set<string>;
  componentWrites: Map<string, Map<string, unknown | typeof REMOVED>>;
};

const baseDirectory = (entities: ReadonlyMap<string, EntityState> = new Map()): EntityDirectory => ({
  depth: 0,
  base: entities,
  added: new Map(),
  removed: new Set(),
});

const directoryEntity = (directory: EntityDirectory, id: string): EntityState | undefined => {
  if (directory.removed.has(id)) return undefined;
  const added = directory.added.get(id);
  if (added) return added;
  return directory.parent ? directoryEntity(directory.parent, id) : directory.base?.get(id);
};

const directoryEntries = (directory: EntityDirectory): Map<string, EntityState> => {
  const values = directory.parent ? directoryEntries(directory.parent) : new Map(directory.base ?? []);
  for (const id of directory.removed) values.delete(id);
  for (const [id, entity] of directory.added) values.set(id, entity);
  return values;
};

const cloneValue = (definition: KernelComponentDefinition, value: unknown): unknown =>
  definition.codec.decode(cloneKernelValue(definition.codec.encode(value)));

const cloneEvent = (event: KernelEvent): KernelEvent => ({ ...event, payload: cloneKernelValue(event.payload) });

const releaseStorages = (storages: readonly KernelComponentStorage<unknown>[]): unknown[] => {
  const failures: unknown[] = [];
  for (let index = storages.length - 1; index >= 0; index--) {
    try {
      storages[index]!.dispose?.();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
};

const assertIdentity = (identity: KernelWorldIdentity, definitions: FrozenKernelDefinitions) => {
  if (!identity.worldId) throw new TypeError('Kernel world requires a stable world id.');
  if (identity.definitionIdentity !== definitions.definitionIdentity)
    throw new TypeError('Kernel world definition identity does not match frozen definitions.');
};

const assertEventCapacity = (capacity: number) => {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 65_536)
    throw new TypeError('Kernel event capacity must be an integer between 1 and 65536.');
};

const assertCheckpointShape = (checkpoint: KernelCheckpointV1) => {
  if (checkpoint.schemaVersion !== 1) throw new TypeError('Kernel checkpoint schema version is unsupported.');
  for (const field of [
    'epoch',
    'revision',
    'commitSequence',
    'logicalTick',
    'nextEntitySequence',
    'lifetimeHighWater',
  ] as const)
    if (!Number.isSafeInteger(checkpoint[field]) || checkpoint[field] < 0)
      throw new TypeError(`Kernel checkpoint ${field} is invalid.`);
  if (checkpoint.commitSequence < checkpoint.revision)
    throw new TypeError('Kernel checkpoint frontier precedes revision.');
  assertEventCapacity(checkpoint.eventCapacity);
  if (checkpoint.events.length > checkpoint.eventCapacity)
    throw new TypeError('Kernel checkpoint exceeds event capacity.');
  let previousSequence = 0;
  for (const event of checkpoint.events) {
    if (
      !Number.isSafeInteger(event.sequence) ||
      event.sequence <= previousSequence ||
      event.sequence > checkpoint.commitSequence ||
      !Number.isSafeInteger(event.revision) ||
      event.revision < 0 ||
      event.revision > checkpoint.revision ||
      !Number.isSafeInteger(event.tick) ||
      event.tick < 0 ||
      event.tick > checkpoint.logicalTick ||
      !event.type
    )
      throw new TypeError('Kernel checkpoint event sequence is invalid.');
    previousSequence = event.sequence;
  }
};

const restoreState = (
  definitions: FrozenKernelDefinitions,
  checkpoint: KernelCheckpointV1,
  components: Map<string, KernelComponentStorage<unknown>>,
): MutableState => {
  assertCheckpointShape(checkpoint);
  const entities = new Map<string, EntityState>();
  for (const entity of checkpoint.entities) {
    if (
      !entity.id ||
      !Number.isSafeInteger(entity.lifetime) ||
      entity.lifetime <= 0 ||
      entity.lifetime > checkpoint.lifetimeHighWater ||
      entities.has(entity.id)
    )
      throw new TypeError(`Kernel checkpoint entity is invalid: ${entity.id}`);
    entities.set(entity.id, { lifetime: entity.lifetime });
  }
  const seen = new Set<string>();
  for (const saved of checkpoint.components) {
    const definition = definitions.components.get(saved.id);
    if (!definition || seen.has(saved.id) || definition.moduleId !== saved.moduleId)
      throw new TypeError(`Kernel checkpoint component identity is invalid: ${saved.id}`);
    if (definition.codec.version !== saved.codecVersion)
      throw new TypeError(`Kernel checkpoint component version is unsupported: ${saved.id}`);
    seen.add(saved.id);
    const entries = components.get(saved.id)!;
    for (const entry of saved.entries) {
      if (!entities.has(entry.entityId) || entries.has(entry.entityId))
        throw new TypeError(`Kernel checkpoint component reference is invalid: ${saved.id}/${entry.entityId}`);
      entries.write(entry.entityId, definition.codec.decode(cloneKernelValue(entry.value)));
    }
    components.set(saved.id, entries);
  }
  for (const id of definitions.components.keys())
    if (!seen.has(id)) throw new TypeError(`Kernel checkpoint is missing required component schema: ${id}`);
  return { entities: baseDirectory(entities), components };
};

export type KernelTransactionContext = KernelSystemContext &
  Readonly<{
    spawn(id?: string): KernelEntityReference;
    remove(entityId: string): void;
  }>;

export type KernelWorldRuntime = ReturnType<typeof createKernelWorld>;

export function createKernelWorld(
  options: Readonly<{
    identity: KernelWorldIdentity;
    definitions: FrozenKernelDefinitions;
    checkpoint?: KernelCheckpointV1;
    eventCapacity?: number;
  }>,
) {
  const identity: KernelWorldIdentity = Object.freeze({ ...options.identity });
  assertIdentity(identity, options.definitions);
  if (
    options.checkpoint &&
    (options.checkpoint.identity.worldId !== identity.worldId ||
      options.checkpoint.identity.definitionIdentity !== identity.definitionIdentity)
  )
    throw new TypeError('Kernel checkpoint world identity does not match the requested world.');
  const eventCapacity = options.eventCapacity ?? options.checkpoint?.eventCapacity ?? 4096;
  assertEventCapacity(eventCapacity);
  if (options.checkpoint && options.checkpoint.events.length > eventCapacity)
    throw new TypeError('Kernel checkpoint exceeds requested event capacity.');
  const kernelRuntime = createKernelRuntime({
    identity,
    definitions: options.definitions,
    initial: {
      epoch: options.checkpoint ? options.checkpoint.epoch + 1 : 1,
      commitSequence: options.checkpoint?.commitSequence ?? 0,
      gameplayRevision: options.checkpoint?.revision ?? 0,
    },
  });
  const components = new Map(
    [...options.definitions.components].map(([id]) => [id, kernelRuntime.componentStorage<unknown>(id)]),
  );
  let state: MutableState;
  let events: KernelEvent[];
  try {
    state = options.checkpoint
      ? restoreState(options.definitions, options.checkpoint, components)
      : { entities: baseDirectory(), components };
    events = (options.checkpoint?.events ?? []).map(cloneEvent);
  } catch (error) {
    try {
      kernelRuntime.dispose();
    } catch {
      // Preserve the restore failure after attempting all owned cleanup.
    }
    throw error;
  }
  const kernelState = kernelRuntime.stateOwner;
  let logicalTick = options.checkpoint?.logicalTick ?? 0;
  let nextEntitySequence = options.checkpoint?.nextEntitySequence ?? 1;
  let lifetimeHighWater = options.checkpoint?.lifetimeHighWater ?? 0;
  const committedStorages: KernelComponentStorage<unknown>[] = [];
  let busy = false;

  const ensureActive = () => {
    kernelState.assertExpectedEpoch(kernelState.epoch);
    if (busy) throw new Error('Kernel world reentry is forbidden.');
  };
  const referenceFor = (id: string, candidate?: CandidateState): KernelEntityReference => {
    const entity = candidate?.removedEntities.has(id)
      ? undefined
      : (candidate?.addedEntities.get(id) ?? directoryEntity(state.entities, id));
    if (!entity) throw new TypeError(`Unknown Kernel entity: ${id}`);
    return Object.freeze({
      id,
      lifetime: entity.lifetime,
      epoch: kernelState.epoch,
      revision: kernelState.gameplayRevision,
    });
  };
  const runTransaction = (prepare: (context: KernelTransactionContext) => void, nextTick: number) => {
    ensureActive();
    busy = true;
    try {
      const candidate: CandidateState = {
        addedEntities: new Map(),
        removedEntities: new Set(),
        componentWrites: new Map(),
      };
      const pendingEvents: Readonly<{ type: string; payload: KernelValue }>[] = [];
      let candidateNextEntitySequence = nextEntitySequence;
      let candidateLifetimeHighWater = lifetimeHighWater;
      const hasEntity = (id: string) =>
        !candidate.removedEntities.has(id) &&
        (candidate.addedEntities.has(id) || directoryEntity(state.entities, id) !== undefined);
      const candidateEntityIds = () => {
        const ids = new Set(directoryEntries(state.entities).keys());
        for (const id of candidate.addedEntities.keys()) ids.add(id);
        for (const id of candidate.removedEntities) ids.delete(id);
        return [...ids].sort();
      };
      const candidateValue = (componentId: string, entityId: string): unknown | typeof REMOVED => {
        const writes = candidate.componentWrites.get(componentId);
        if (writes?.has(entityId)) return writes.get(entityId)!;
        if (candidate.removedEntities.has(entityId)) return REMOVED;
        const value = state.components.get(componentId)?.read(entityId);
        return value === undefined ? REMOVED : value;
      };
      const context: KernelTransactionContext = Object.freeze({
        tick: nextTick,
        entities: () => Object.freeze(candidateEntityIds().map((id) => referenceFor(id, candidate))),
        has: (componentId, entityId) => candidateValue(componentId, entityId) !== REMOVED,
        read: (componentId, entityId) => {
          const definition = options.definitions.components.get(componentId);
          const value = candidateValue(componentId, entityId);
          if (!definition || value === REMOVED) return undefined;
          return cloneValue(definition, value);
        },
        write: (componentId, entityId, value) => {
          const definition = options.definitions.components.get(componentId);
          if (!definition) throw new TypeError(`Unknown Kernel component: ${componentId}`);
          if (!hasEntity(entityId)) throw new TypeError(`Unknown Kernel entity: ${entityId}`);
          let writes = candidate.componentWrites.get(componentId);
          if (!writes) {
            writes = new Map();
            candidate.componentWrites.set(componentId, writes);
          }
          writes.set(entityId, cloneValue(definition, value));
        },
        emit: (type, payload) => {
          if (!type) throw new TypeError('Kernel event type is required.');
          if (events.length + pendingEvents.length >= eventCapacity)
            throw new RangeError('Kernel event capacity exceeded.');
          pendingEvents.push({ type, payload: cloneKernelValue(payload) });
        },
        spawn: (requestedId) => {
          const id = requestedId ?? `entity:${candidateNextEntitySequence++}`;
          if (!id || hasEntity(id)) throw new TypeError(`Kernel entity id is invalid or duplicated: ${id}`);
          if (candidateLifetimeHighWater >= Number.MAX_SAFE_INTEGER)
            throw new RangeError('Kernel entity lifetime exhausted.');
          candidate.removedEntities.delete(id);
          candidate.addedEntities.set(id, { lifetime: ++candidateLifetimeHighWater });
          for (const [componentId, definition] of options.definitions.components) {
            const initial = definition.lifecycle?.initialize?.(id);
            if (initial === undefined) continue;
            let writes = candidate.componentWrites.get(componentId);
            if (!writes) {
              writes = new Map();
              candidate.componentWrites.set(componentId, writes);
            }
            writes.set(id, cloneValue(definition, initial));
          }
          return referenceFor(id, candidate);
        },
        remove: (entityId) => {
          if (!hasEntity(entityId)) throw new TypeError(`Unknown Kernel entity: ${entityId}`);
          candidate.addedEntities.delete(entityId);
          candidate.removedEntities.add(entityId);
          for (const componentId of options.definitions.components.keys()) {
            let writes = candidate.componentWrites.get(componentId);
            if (!writes) {
              writes = new Map();
              candidate.componentWrites.set(componentId, writes);
            }
            writes.set(entityId, REMOVED);
          }
        },
      });
      prepare(context);
      kernelState.assertGameplayCommitCapacity(kernelState.epoch, pendingEvents.length);
      const committedRevision = kernelState.gameplayRevision + 1;
      const committedEvents: KernelEvent[] = pendingEvents.map(({ type, payload }, index) => ({
        sequence: kernelState.commitSequence + index + 1,
        revision: committedRevision,
        tick: nextTick,
        type,
        payload,
      }));
      const candidateComponents = new Map(state.components);
      const preparedStorages: KernelComponentStorage<unknown>[] = [];
      try {
        for (const [componentId, writes] of candidate.componentWrites) {
          const prepared = state.components
            .get(componentId)!
            .fork([...writes].map(([entityId, value]) => (value === REMOVED ? { entityId } : { entityId, value })));
          preparedStorages.push(prepared);
          candidateComponents.set(componentId, prepared);
        }
        for (const entityId of candidate.removedEntities)
          for (const [componentId, store] of state.components) {
            const previous = store.read(entityId);
            const definition = options.definitions.components.get(componentId)!;
            if (previous !== undefined && definition.lifecycle?.deleted)
              definition.lifecycle.deleted(entityId, cloneValue(definition, previous));
          }
      } catch (error) {
        releaseStorages(preparedStorages);
        throw error;
      }
      let candidateDirectory = state.entities;
      if (candidate.addedEntities.size || candidate.removedEntities.size) {
        const parent = state.entities.depth >= 127 ? baseDirectory(directoryEntries(state.entities)) : state.entities;
        candidateDirectory = {
          depth: parent.depth + 1,
          parent,
          added: candidate.addedEntities,
          removed: candidate.removedEntities,
        };
      }
      kernelState.commitGameplayTransaction(kernelState.epoch, pendingEvents.length);
      committedStorages.push(...preparedStorages.filter((storage) => storage.dispose));
      state = { entities: candidateDirectory, components: candidateComponents };
      nextEntitySequence = candidateNextEntitySequence;
      lifetimeHighWater = candidateLifetimeHighWater;
      logicalTick = nextTick;
      for (const event of committedEvents) events.push(event);
      return Object.freeze({ revision: committedRevision, events: Object.freeze(committedEvents.map(cloneEvent)) });
    } finally {
      busy = false;
    }
  };

  return Object.freeze({
    get identity() {
      return identity;
    },
    get epoch() {
      return kernelState.epoch;
    },
    get revision() {
      return kernelState.gameplayRevision;
    },
    get logicalTick() {
      return logicalTick;
    },
    transact(expectedEpoch: number, prepare: (context: KernelTransactionContext) => void) {
      kernelState.assertExpectedEpoch(expectedEpoch);
      return runTransaction(prepare, logicalTick);
    },
    advance(expectedEpoch: number) {
      kernelState.assertExpectedEpoch(expectedEpoch);
      return runTransaction((context) => {
        for (const system of options.definitions.systems) system.run(context);
      }, logicalTick + 1);
    },
    read<State>(componentId: string, entityId: string): State | undefined {
      ensureActive();
      const definition = options.definitions.components.get(componentId);
      const value = state.components.get(componentId)?.read(entityId);
      return definition && value !== undefined ? (cloneValue(definition, value) as State) : undefined;
    },
    entities(): readonly KernelEntityReference[] {
      ensureActive();
      return Object.freeze([...directoryEntries(state.entities).keys()].sort().map((id) => referenceFor(id)));
    },
    events(): readonly KernelEvent[] {
      ensureActive();
      return Object.freeze(events.map(cloneEvent));
    },
    acknowledgeEvents(expectedEpoch: number, throughSequence: number): number {
      ensureActive();
      kernelState.assertExpectedEpoch(expectedEpoch);
      if (!Number.isSafeInteger(throughSequence) || throughSequence < 0 || throughSequence > kernelState.commitSequence)
        throw new TypeError('Kernel event acknowledgement sequence is invalid.');
      const retained = events.filter((event) => event.sequence > throughSequence);
      const removed = events.length - retained.length;
      if (!removed) return 0;
      kernelState.commitEvent(expectedEpoch);
      events = retained;
      return removed;
    },
    checkpoint(): KernelCheckpointV1 {
      ensureActive();
      return Object.freeze({
        schemaVersion: 1,
        identity,
        epoch: kernelState.epoch,
        revision: kernelState.gameplayRevision,
        commitSequence: kernelState.commitSequence,
        logicalTick,
        nextEntitySequence,
        lifetimeHighWater,
        eventCapacity,
        entities: Object.freeze(
          [...directoryEntries(state.entities)]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([id, entity]) => ({ id, lifetime: entity.lifetime })),
        ),
        components: Object.freeze(
          [...options.definitions.components]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([id, definition]) => ({
              id,
              moduleId: definition.moduleId,
              codecVersion: definition.codec.version,
              entries: Object.freeze(
                [...(state.components.get(id)?.entries() ?? [])]
                  .sort((left, right) => left.entityId.localeCompare(right.entityId))
                  .map(({ entityId, value }) => ({
                    entityId,
                    value: cloneKernelValue(definition.codec.encode(value)),
                  })),
              ),
            })),
        ),
        events: Object.freeze(events.map(cloneEvent)),
      });
    },
    dispose(): void {
      ensureActive();
      const failures = releaseStorages(committedStorages);
      committedStorages.length = 0;
      try {
        kernelRuntime.dispose();
      } catch (error) {
        failures.push(error);
      }
      state = { entities: baseDirectory(), components: new Map() };
      events = [];
      if (failures.length) throw failures[0];
    },
  });
}
