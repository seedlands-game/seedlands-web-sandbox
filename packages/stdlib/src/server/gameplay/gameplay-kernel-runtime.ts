import {
  createKernelDefinitionRegistry,
  createKernelRuntime,
  defineComponent,
  defineModule,
  type KernelComponentStorage,
  type KernelModuleDefinition,
  type KernelRuntimeCheckpoint,
  type KernelRegistrationFacet,
  type KernelStorageAllocationPort,
  type KernelValue,
  type KernelWorldIdentity,
} from '@seedlands/kernel';
import type { WorldComposition } from '../composition/contracts';
import { EntityStore, type GameplayEntity } from './entity-store';
import type { GameplayContent } from './gameplay-content';
import {
  AUTHORITY_RUNTIME_MODULE,
  AUTHORITY_SESSION_STATE,
  createAuthorityKernelState,
  decodeAuthorityKernelState,
  encodeAuthorityKernelState,
  type AuthorityKernelState,
} from '../authority/authority-kernel-state';

const ENTITY_RUNTIME_MODULE = 'seedlands:entity-runtime';
const ENTITY_STATE = 'seedlands:entity-state';
const SHARED_ENTITY_STORE = 'seedlands:entity-store';

const asKernelValue = (value: unknown): KernelValue => value as KernelValue;

const storeFor = (port: KernelStorageAllocationPort, content: GameplayContent) =>
  port.shared(SHARED_ENTITY_STORE, () => new EntityStore(content.items, content.stations?.codec));

const entityProjectionStorage = (
  port: KernelStorageAllocationPort,
  content: GameplayContent,
  project: (store: EntityStore, entity: GameplayEntity) => unknown,
): KernelComponentStorage<KernelValue> => {
  const store = storeFor(port, content);
  const storage: KernelComponentStorage<KernelValue> = Object.freeze({
    has: (entityId: string) => store.get(entityId) !== null,
    read: (entityId: string) => {
      const entity = store.get(entityId);
      return entity ? asKernelValue(project(store, entity)) : undefined;
    },
    write: () => {
      throw new Error('Registered gameplay component storage is mutated only through prepared stdlib candidates.');
    },
    delete: (entityId: string) => {
      store.despawn(entityId);
    },
    entries: () =>
      store.query().map((entity) => ({ entityId: entity.id, value: asKernelValue(project(store, entity)) })),
    fork: (writes) => {
      if (writes.length) throw new Error('Gameplay projection storage cannot be written by the generic Kernel.');
      return storage;
    },
  });
  return storage;
};

const componentCodec = Object.freeze({
  version: 1,
  encode: (value: KernelValue) => value,
  decode: (value: KernelValue) => value,
});

const definitionValue = (value: unknown) => asKernelValue(value);

const facet = (id: string, moduleId: string, version: string, definition?: unknown): KernelRegistrationFacet =>
  Object.freeze({
    id,
    moduleId,
    version,
    ...(definition === undefined ? {} : { definition: definitionValue(definition) }),
  });

export function createGameplayKernelRuntime(
  content: GameplayContent,
  composition?: WorldComposition,
  worldId = composition?.playbookId ?? 'seedlands:uncomposed-world',
  additionalModules: readonly KernelModuleDefinition[] = [],
  checkpoint?: KernelRuntimeCheckpoint,
) {
  const registry = createKernelDefinitionRegistry();
  registry.register(
    defineModule({
      id: ENTITY_RUNTIME_MODULE,
      version: '1.0.0',
      components: [
        [
          'seedlands:entity-identity',
          (store: EntityStore, entity: GameplayEntity) => ({
            id: entity.id,
            lifetime: store.createReference(entity.id)?.lifetime ?? 0,
            type: entity.type,
          }),
        ],
        [
          'seedlands:actor-state',
          (store: EntityStore, entity: GameplayEntity) =>
            entity.health === undefined ? null : store.actorComponentSnapshot(entity.id),
        ],
        [
          'seedlands:inventory-state',
          (store: EntityStore, entity: GameplayEntity) =>
            entity.health === undefined ? null : store.actorComponentSnapshot(entity.id).inventory,
        ],
        [
          'seedlands:character-state',
          (store: EntityStore, entity: GameplayEntity) =>
            entity.health === undefined ? null : store.actorComponentSnapshot(entity.id).character,
        ],
        [
          'seedlands:station-state',
          (store: EntityStore, entity: GameplayEntity) =>
            entity.type === 'station' ? store.stationSnapshot(entity.id) : null,
        ],
      ].map(([id, project]) =>
        defineComponent({
          id: id as string,
          moduleId: ENTITY_RUNTIME_MODULE,
          codec: componentCodec,
          storage: (port) =>
            entityProjectionStorage(port, content, project as (store: EntityStore, entity: GameplayEntity) => unknown),
        }),
      ),
      moduleStates: [
        {
          id: ENTITY_STATE,
          moduleId: ENTITY_RUNTIME_MODULE,
          codec: {
            version: 2,
            encode: (store: EntityStore) => asKernelValue(store.exportComponentSnapshot()),
            decode: (value) => {
              const store = new EntityStore(content.items, content.stations?.codec);
              store.restoreComponentSnapshot(value);
              return store;
            },
          },
          create: (port) => storeFor(port, content),
          restore: (port, value) => {
            const store = storeFor(port, content);
            store.restoreComponentSnapshot(value);
            return store;
          },
          dispose: (store: EntityStore) => store.dispose(),
        },
      ],
    }),
  );
  registry.register(
    defineModule({
      id: AUTHORITY_RUNTIME_MODULE,
      version: '1.0.0',
      moduleStates: [
        {
          id: AUTHORITY_SESSION_STATE,
          moduleId: AUTHORITY_RUNTIME_MODULE,
          codec: {
            version: 1,
            encode: encodeAuthorityKernelState,
            decode: decodeAuthorityKernelState,
          },
          create: createAuthorityKernelState,
          dispose: () => undefined,
        },
      ],
    }),
  );
  for (const module of additionalModules) registry.register(module);
  if (composition) {
    for (const module of composition.definitionMap.modules) {
      const stateCodecs = composition.definitionMap.stateCodecs
        .filter((entry) => entry.moduleId === module.id)
        .map((entry) => facet(entry.id, module.id, entry.version, entry));
      const operations = composition.definitionMap.operations
        .filter((entry) => entry.moduleId === module.id)
        .map((entry) => facet(entry.id, module.id, '1.0.0', entry));
      const rules = composition.definitionMap.rules
        .filter((entry) => entry.moduleId === module.id)
        .map((entry) => facet(entry.id, module.id, '1.0.0', entry));
      const capabilities = composition.definitionMap.capabilities
        .filter((entry) => entry.moduleId === module.id)
        .map((entry) => facet(entry.id, module.id, entry.version, entry.definitionIdentity));
      const systemDefinitions = composition.definitionMap.systems
        .filter((entry) => entry.moduleId === module.id)
        .map((entry) => facet(entry.definition.id, module.id, '1.0.0', entry.definition));
      const resources = composition.definitionMap.resources
        .filter((resource) => {
          const owner = [...composition.definitionMap.stateCodecs, ...composition.definitionMap.operations].find(
            (entry) => entry.resource === resource.id,
          );
          return owner?.moduleId === module.id;
        })
        .map((resource) => facet(resource.id, module.id, '1.0.0', resource));
      registry.register(
        defineModule({
          id: module.id,
          version: module.version,
          stateCodecs,
          operations,
          rules,
          capabilities,
          systemDefinitions,
          systems: [],
          resources,
          providers: capabilities
            .filter(({ id }) => id === 'seedlands:worldgen-provider')
            .map((provider) => ({
              ...provider,
              capabilityId: provider.id,
              configurationIdentity: provider.definition ? JSON.stringify(provider.definition) : 'unspecified',
              artifactIdentity: provider.definition ? JSON.stringify(provider.definition) : 'unspecified',
            })),
        }),
      );
    }
  }
  const definitions = registry.freeze();
  const identity: KernelWorldIdentity = Object.freeze({ worldId, definitionIdentity: definitions.definitionIdentity });
  const runtime = createKernelRuntime({ identity, definitions, checkpoint });
  return Object.freeze({
    runtime,
    entities: runtime.state<EntityStore>(ENTITY_STATE),
    authority: runtime.state<AuthorityKernelState>(AUTHORITY_SESSION_STATE),
  });
}
