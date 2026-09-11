export type KernelValue = null | boolean | number | string | readonly KernelValue[] | KernelRecord;
export type KernelRecord = Readonly<{ [key: string]: KernelValue }>;

export type KernelWorldIdentity = Readonly<{
  worldId: string;
  definitionIdentity: string;
}>;

export type KernelComponentCodec<State> = Readonly<{
  version: number;
  /** Pure conversion: must not mutate the supplied value or previously published state. */
  encode(value: State): KernelValue;
  /** Pure conversion; the Kernel supplies an isolated wire value at external boundaries. */
  decode(value: KernelValue): State;
}>;

export type KernelStorageAllocationPort = Readonly<{
  uint8(length: number): Uint8Array;
  uint16(length: number): Uint16Array;
  uint32(length: number): Uint32Array;
  float64(length: number): Float64Array;
  shared<Value>(id: string, create: () => Value): Value;
}>;

export type KernelComponentStorage<State> = Readonly<{
  /** Reads are side-effect free. Returned storage values are borrowed and must not be mutated. */
  has(entityId: string): boolean;
  read(entityId: string): State | undefined;
  /** Direct writes are for an unpublished owner; live transactions publish a forked root. */
  write(entityId: string, value: State): void;
  delete(entityId: string): void;
  entries(): readonly Readonly<{ entityId: string; value: State }>[];
  /** Prepare an isolated candidate. May throw; must not mutate or dispose the parent or its values.
   * Candidate disposal releases only candidate-owned resources. Publication is a no-callback root swap.
   */
  fork(writes: readonly Readonly<{ entityId: string; value?: State }>[]): KernelComponentStorage<State>;
  dispose?(): void;
}>;

export type KernelComponentLifecycle<State> = Readonly<{
  initialize?(entityId: string): State | undefined;
  /** Pre-publication validation, given a codec copy. May reject; no external side effects. */
  deleted?(entityId: string, value: State): void;
}>;

export type KernelComponentDefinition<State = unknown> = Readonly<{
  id: string;
  moduleId: string;
  dependencies?: readonly string[];
  codec: KernelComponentCodec<State>;
  storage(port: KernelStorageAllocationPort): KernelComponentStorage<State>;
  lifecycle?: KernelComponentLifecycle<State>;
}>;

export type KernelModuleStateDefinition<State = unknown> = Readonly<{
  id: string;
  moduleId: string;
  dependencies?: readonly string[];
  codec: KernelComponentCodec<State>;
  create(port: KernelStorageAllocationPort): State;
  restore?(port: KernelStorageAllocationPort, value: KernelValue): State;
  dispose(value: State): void;
}>;

export type KernelRegistrationFacet = Readonly<{
  id: string;
  moduleId: string;
  version: string;
  dependencies?: readonly string[];
  definition?: KernelValue;
}>;

export type KernelExclusiveProviderDefinition = KernelRegistrationFacet &
  Readonly<{
    capabilityId: string;
    configurationIdentity: string;
    artifactIdentity: string;
  }>;

export type KernelSystemContext = Readonly<{
  tick: number;
  entities(): readonly KernelEntityReference[];
  has(componentId: string, entityId: string): boolean;
  read(componentId: string, entityId: string): unknown;
  write(componentId: string, entityId: string, value: unknown): void;
  emit(type: string, payload: KernelValue): void;
}>;

export type KernelSystemDefinition = Readonly<{
  id: string;
  moduleId: string;
  phase: number;
  order: number;
  after?: readonly string[];
  run(context: KernelSystemContext): void;
}>;

export type KernelModuleDefinition = Readonly<{
  id: string;
  version: string;
  requiredModules?: readonly string[];
  components?: readonly KernelComponentDefinition[];
  moduleStates?: readonly KernelModuleStateDefinition[];
  stateCodecs?: readonly KernelRegistrationFacet[];
  systems?: readonly KernelSystemDefinition[];
  systemDefinitions?: readonly KernelRegistrationFacet[];
  operations?: readonly KernelRegistrationFacet[];
  rules?: readonly KernelRegistrationFacet[];
  resources?: readonly KernelRegistrationFacet[];
  capabilities?: readonly KernelRegistrationFacet[];
  providers?: readonly KernelExclusiveProviderDefinition[];
}>;

export type KernelEntityReference = Readonly<{
  id: string;
  lifetime: number;
  epoch: number;
  revision: number;
}>;

export type KernelEvent = Readonly<{
  sequence: number;
  revision: number;
  tick: number;
  type: string;
  payload: KernelValue;
}>;

export type KernelComponentCheckpoint = Readonly<{
  id: string;
  moduleId: string;
  codecVersion: number;
  entries: readonly Readonly<{ entityId: string; value: KernelValue }>[];
}>;

export type KernelCheckpointV1 = Readonly<{
  schemaVersion: 1;
  identity: KernelWorldIdentity;
  epoch: number;
  revision: number;
  commitSequence: number;
  logicalTick: number;
  nextEntitySequence: number;
  lifetimeHighWater: number;
  entities: readonly Readonly<{ id: string; lifetime: number }>[];
  components: readonly KernelComponentCheckpoint[];
  eventCapacity: number;
  events: readonly KernelEvent[];
}>;

export type FrozenKernelDefinitions = Readonly<{
  modules: readonly KernelModuleDefinition[];
  components: ReadonlyMap<string, KernelComponentDefinition>;
  moduleStates: ReadonlyMap<string, KernelModuleStateDefinition>;
  stateCodecs: ReadonlyMap<string, KernelRegistrationFacet>;
  systems: readonly KernelSystemDefinition[];
  systemDefinitions: ReadonlyMap<string, KernelRegistrationFacet>;
  operations: ReadonlyMap<string, KernelRegistrationFacet>;
  rules: ReadonlyMap<string, KernelRegistrationFacet>;
  resources: ReadonlyMap<string, KernelRegistrationFacet>;
  capabilities: ReadonlyMap<string, KernelRegistrationFacet>;
  providers: ReadonlyMap<string, KernelExclusiveProviderDefinition>;
  definitionIdentity: string;
}>;

export function defineComponent<State>(definition: KernelComponentDefinition<State>): KernelComponentDefinition<State> {
  return Object.freeze({ ...definition, dependencies: Object.freeze([...(definition.dependencies ?? [])]) });
}

export function defineSystem(definition: KernelSystemDefinition): KernelSystemDefinition {
  return Object.freeze({ ...definition, after: Object.freeze([...(definition.after ?? [])]) });
}

export function defineModule(definition: KernelModuleDefinition): KernelModuleDefinition {
  return Object.freeze({
    ...definition,
    requiredModules: Object.freeze([...(definition.requiredModules ?? [])]),
    components: Object.freeze([...(definition.components ?? [])]),
    moduleStates: Object.freeze([...(definition.moduleStates ?? [])]),
    stateCodecs: Object.freeze([...(definition.stateCodecs ?? [])]),
    systems: Object.freeze([...(definition.systems ?? [])]),
    systemDefinitions: Object.freeze([...(definition.systemDefinitions ?? [])]),
    operations: Object.freeze([...(definition.operations ?? [])]),
    rules: Object.freeze([...(definition.rules ?? [])]),
    resources: Object.freeze([...(definition.resources ?? [])]),
    capabilities: Object.freeze([...(definition.capabilities ?? [])]),
    providers: Object.freeze([...(definition.providers ?? [])]),
  });
}

const layeredMapKernelComponentStorage = <State>(
  parent?: KernelComponentStorage<State>,
  initial: readonly Readonly<{ entityId: string; value?: State }>[] = [],
  depth = 0,
): KernelComponentStorage<State> => {
  const writes = new Map<string, State | typeof deleted>();
  const deleted = Symbol('deleted');
  for (const entry of initial) writes.set(entry.entityId, entry.value === undefined ? deleted : entry.value);
  const storage: KernelComponentStorage<State> = Object.freeze({
    has: (entityId: string) => {
      const value = writes.get(entityId);
      return value === deleted ? false : value !== undefined || Boolean(parent?.has(entityId));
    },
    read: (entityId: string) => {
      const value = writes.get(entityId);
      return value === deleted ? undefined : value === undefined ? parent?.read(entityId) : value;
    },
    write: (entityId: string, value: State) => writes.set(entityId, value),
    delete: (entityId: string) => writes.set(entityId, deleted),
    entries: () => {
      const merged = new Map((parent?.entries() ?? []).map((entry) => [entry.entityId, entry.value]));
      for (const [entityId, value] of writes) {
        if (value === deleted) merged.delete(entityId);
        else merged.set(entityId, value);
      }
      return [...merged].map(([entityId, value]) => ({ entityId, value }));
    },
    // Bound retained ancestry and recursive reads without copying all values every tick.
    fork: (candidate) =>
      depth >= 127
        ? layeredMapKernelComponentStorage(undefined, [...storage.entries(), ...candidate])
        : layeredMapKernelComponentStorage(storage, candidate, depth + 1),
  });
  return storage;
};

export function createMapKernelComponentStorage<State>(): KernelComponentStorage<State> {
  return layeredMapKernelComponentStorage<State>();
}
