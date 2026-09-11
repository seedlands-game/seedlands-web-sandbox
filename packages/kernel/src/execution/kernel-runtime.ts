import type {
  FrozenKernelDefinitions,
  KernelComponentStorage,
  KernelModuleStateDefinition,
  KernelStorageAllocationPort,
  KernelValue,
  KernelWorldIdentity,
} from '../registry/contracts';
import { cloneKernelValue } from '../registry/clone-value';
import { createKernelStateOwner, type KernelStateSnapshot } from './state-owner';

const createStoragePort = (): KernelStorageAllocationPort => {
  const shared = new Map<string, unknown>();
  return Object.freeze({
    uint8: (length: number) => new Uint8Array(length),
    uint16: (length: number) => new Uint16Array(length),
    uint32: (length: number) => new Uint32Array(length),
    float64: (length: number) => new Float64Array(length),
    shared<Value>(id: string, create: () => Value): Value {
      if (!id) throw new TypeError('Kernel shared storage id is required.');
      if (!shared.has(id)) shared.set(id, create());
      return shared.get(id) as Value;
    },
  });
};

export type KernelRuntimeCheckpoint = Readonly<{
  identity: KernelWorldIdentity;
  state: KernelStateSnapshot;
  modules: readonly Readonly<{ id: string; codecVersion: number; value: KernelValue }>[];
}>;

export function createKernelRuntime(
  options: Readonly<{
    identity: KernelWorldIdentity;
    definitions: FrozenKernelDefinitions;
    initial?: Partial<KernelStateSnapshot>;
    checkpoint?: KernelRuntimeCheckpoint;
  }>,
) {
  const identity: KernelWorldIdentity = Object.freeze({ ...options.identity });
  if (!identity.worldId || identity.definitionIdentity !== options.definitions.definitionIdentity)
    throw new TypeError('Kernel runtime identity does not match its frozen definitions.');
  if (
    options.checkpoint &&
    (options.checkpoint.identity.worldId !== identity.worldId ||
      options.checkpoint.identity.definitionIdentity !== identity.definitionIdentity)
  )
    throw new TypeError('Kernel runtime checkpoint identity does not match its frozen definitions.');
  if (
    options.checkpoint &&
    options.checkpoint.state.commitSequence <
      Math.max(options.checkpoint.state.worldRevision, options.checkpoint.state.gameplayRevision)
  )
    throw new TypeError('Kernel runtime checkpoint commit frontier precedes a registered revision.');
  const restored = new Map<string, KernelValue>();
  if (options.checkpoint) {
    const seen = new Set<string>();
    for (const saved of options.checkpoint.modules) {
      const definition = options.definitions.moduleStates.get(saved.id);
      if (!definition || seen.has(saved.id) || definition.codec.version !== saved.codecVersion)
        throw new TypeError(`Kernel module state identity is invalid: ${saved.id}`);
      restored.set(saved.id, cloneKernelValue(saved.value));
      seen.add(saved.id);
    }
    for (const id of options.definitions.moduleStates.keys())
      if (!seen.has(id)) throw new TypeError(`Kernel checkpoint is missing module state: ${id}`);
  }
  const initial = options.checkpoint
    ? { ...options.checkpoint.state, epoch: options.checkpoint.state.epoch + 1 }
    : options.initial;
  const stateOwner = createKernelStateOwner(initial);
  const storagePort = createStoragePort();
  const states = new Map<string, unknown>();
  const componentStorages = new Map<string, KernelComponentStorage<unknown>>();
  try {
    for (const [id, definition] of options.definitions.components) {
      const storage = stateOwner.createParticipant({
        id: `kernel:component-storage/${id}`,
        create: () => definition.storage(storagePort),
        dispose: (candidate) => candidate.dispose?.(),
      });
      componentStorages.set(id, storage);
    }
    for (const definition of options.definitions.moduleStates.values()) {
      const value = stateOwner.createParticipant({
        id: definition.id,
        create: () => {
          const saved = restored.get(definition.id);
          return saved === undefined
            ? definition.create(storagePort)
            : (definition.restore?.(storagePort, cloneKernelValue(saved)) ??
                definition.codec.decode(cloneKernelValue(saved)));
        },
        dispose: (candidate) => definition.dispose(candidate),
      });
      states.set(definition.id, value);
    }
    stateOwner.freezeParticipants();
  } catch (error) {
    try {
      stateOwner.dispose();
    } catch {
      // Preserve the creation or decoder failure that prevented publication.
    }
    throw error;
  }
  return Object.freeze({
    identity,
    definitions: options.definitions,
    stateOwner,
    state<Value>(id: string): Value {
      if (!states.has(id)) throw new TypeError(`Kernel module state is not registered: ${id}`);
      return states.get(id) as Value;
    },
    componentStorage<Value>(id: string) {
      if (!componentStorages.has(id)) throw new TypeError(`Kernel component storage is not registered: ${id}`);
      return componentStorages.get(id) as import('../registry/contracts').KernelComponentStorage<Value>;
    },
    checkpoint(): KernelRuntimeCheckpoint {
      return Object.freeze({
        identity,
        state: stateOwner.snapshot(),
        modules: Object.freeze(
          [...options.definitions.moduleStates].map(([id, definition]) => ({
            id,
            codecVersion: definition.codec.version,
            value: cloneKernelValue((definition as KernelModuleStateDefinition<unknown>).codec.encode(states.get(id))),
          })),
        ),
      });
    },
    dispose: () => stateOwner.dispose(),
  });
}

export type KernelRuntime = ReturnType<typeof createKernelRuntime>;
