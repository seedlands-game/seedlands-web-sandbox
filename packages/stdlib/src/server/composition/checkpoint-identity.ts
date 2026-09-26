import type { WorldComposition, WorldDefinitionMap } from './contracts';
import type { GameplaySnapshotPredecessorV1 } from '../gameplay/gameplay-snapshot-migration';

export type CompositionCheckpointIdentity = Readonly<{
  version: 1;
  playbookId: string;
  packLock: WorldComposition['packLock'];
  definitionMap: WorldDefinitionMap;
}>;

const INVENTORY_POINTER_PREDECESSOR_OVERWORLD = Object.freeze({
  manifestDigest: '05bc5e57bb6cfd4ed0e2da821f8b6e803bb7e3676453988a131a4b8524c066dd',
  entryDigest: '4a773fe7225f13ef018def0a930b469aa82e558fdebc5172b7ef602ed8e148e2',
});
const NPC_COMPOSABLE_PREDECESSOR_OVERWORLD = Object.freeze({
  manifestDigest: '05bc5e57bb6cfd4ed0e2da821f8b6e803bb7e3676453988a131a4b8524c066dd',
  entryDigest: '7583373d53f9cb3f2447bf40478eb9f8d817adc80060effa385633ecaacf5e6a',
});
const KERNEL_MIGRATION_PREDECESSOR_OVERWORLD = Object.freeze({
  manifestDigest: 'e3c199e87d101672c1635d481771972edbf39deb43c336063ab3753d0b01bb89',
  entryDigest: '924d61fc72f253c85e191caa79f1c7ff51f83bc6237ad613a7c0c5595c2c169f',
});
const BEHAVIOR_REGISTRY_MODULE = 'seedlands:behavior-registry-module';
const BEHAVIOR_REGISTRY_CAPABILITY = 'seedlands:behavior-registry';
const OVERWORLD_WORLDGEN_MODULE = 'seedlands:overworld-worldgen';
const WORLDGEN_PROVIDER_CAPABILITY = 'seedlands:worldgen-provider';
const NAMESPACE_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const RESOURCE_ID = /^[a-z0-9][a-z0-9._:-]*$/;
const STORAGE_ID = /^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._/-]*)?$/;
const EXACT_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const WORLD_OPERATIONS = new Set(['read', 'execute', 'write', 'control', 'export', 'restore']);
const MAX_IDENTITY_ROWS = 4_096;
const SPLIT_CONTENT_CAPABILITIES = new Set([
  'seedlands:recipes',
  'seedlands:melee-definitions',
  'seedlands:station-content',
  'seedlands:content-crafting',
  'seedlands:gameplay-snapshot-migration',
]);

const legacyContentDefinitionMap = (definitionMap: WorldDefinitionMap): Omit<WorldDefinitionMap, 'schemaVersion'> => {
  const { schemaVersion: _schemaVersion, ...legacy } = definitionMap;
  void _schemaVersion;
  const capabilities = legacy.capabilities
    .filter(({ id }) => !SPLIT_CONTENT_CAPABILITIES.has(id))
    .map(({ definitionIdentity: _definitionIdentity, ...capability }) => capability);
  if (!capabilities.some(({ id }) => id === 'seedlands:gameplay-content'))
    capabilities.push({ id: 'seedlands:gameplay-content', moduleId: 'seedlands:overworld-content', version: '1.0.0' });
  capabilities.sort((left, right) => left.id.localeCompare(right.id));
  return { ...legacy, capabilities };
};

export function canonicalCompositionCheckpointIdentity(input: unknown): string {
  let budget = 1_048_576;
  const active = new Set<object>();
  const visit = (value: unknown, depth: number): string => {
    if (--budget < 0 || depth > 32) throw new TypeError('Composition identity exceeds data limits.');
    if (value === null || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'string') {
      budget -= value.length;
      return JSON.stringify(value);
    }
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (typeof value !== 'object' || value === null || active.has(value))
      throw new TypeError('Composition identity must be JSON data.');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value))
      throw new TypeError('Invalid composition identity object.');
    active.add(value);
    const keys = Object.keys(value).sort();
    if (Reflect.ownKeys(value).length !== keys.length + (Array.isArray(value) ? 1 : 0))
      throw new TypeError('Composition identity contains unsupported fields.');
    let result: string;
    if (Array.isArray(value)) {
      if (keys.length !== value.length) throw new TypeError('Composition identity arrays must be dense.');
      const entries: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor) throw new TypeError('Composition identity arrays must be dense.');
        if (!('value' in descriptor)) throw new TypeError('Composition identity accessors are forbidden.');
        entries.push(visit(descriptor.value, depth + 1));
      }
      result = `[${entries.join(',')}]`;
    } else {
      const entries = keys.map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor))
          throw new TypeError('Composition identity accessors are forbidden.');
        budget -= key.length;
        return [key, descriptor.value] as const;
      });
      result = `{${entries
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => `${JSON.stringify(key)}:${visit(entry, depth + 1)}`)
        .join(',')}}`;
    }
    active.delete(value);
    return result;
  };
  const result = visit(input, 0);
  if (budget < 0) throw new TypeError('Composition identity exceeds data limits.');
  return result;
}
const canonicalData = canonicalCompositionCheckpointIdentity;

const record = (raw: unknown, label: string): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`${label} is invalid.`);
  return raw as Record<string, unknown>;
};
const exactKeys = (raw: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) => {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(raw, key)) ||
    Reflect.ownKeys(raw).some((key) => typeof key !== 'string' || !allowed.has(key))
  )
    throw new TypeError('Composition checkpoint identity has an invalid shape.');
};
const dense = (raw: unknown, label: string): readonly unknown[] => {
  if (!Array.isArray(raw) || raw.length > MAX_IDENTITY_ROWS || Reflect.ownKeys(raw).length !== raw.length + 1)
    throw new TypeError(`${label} must be a bounded dense array.`);
  return raw;
};
const id = (raw: unknown, label: string): string => {
  if (typeof raw !== 'string' || raw.length > 256 || !NAMESPACE_ID.test(raw))
    throw new TypeError(`${label} is invalid.`);
  return raw;
};
const version = (raw: unknown, label: string): string => {
  if (typeof raw !== 'string' || raw.length > 128 || !EXACT_VERSION.test(raw))
    throw new TypeError(`${label} is invalid.`);
  return raw;
};
const string = (raw: unknown, label: string): string => {
  if (typeof raw !== 'string' || !raw || raw.length > 4_096) throw new TypeError(`${label} is invalid.`);
  return raw;
};
const identityRow = (raw: unknown, required: readonly string[], optional: readonly string[] = []) => {
  const value = record(raw, 'Composition checkpoint identity row');
  exactKeys(value, required, optional);
  return value;
};
const validateOperationNames = (raw: unknown, label: string): void => {
  const operations = dense(raw, label);
  if (!operations.length || operations.some((operation) => !WORLD_OPERATIONS.has(String(operation))))
    throw new TypeError(`${label} is invalid.`);
  if (new Set(operations).size !== operations.length) throw new TypeError(`${label} contains duplicates.`);
};
const validateDependencyIds = (raw: unknown, label: string): void => {
  const dependencies = dense(raw, label).map((dependency) => id(dependency, label));
  if (new Set(dependencies).size !== dependencies.length) throw new TypeError(`${label} contains duplicates.`);
};
const uniqueRows = (raw: readonly unknown[], keyFor: (row: Record<string, unknown>) => string, label: string) => {
  const keys = raw.map((row) => keyFor(record(row, label)));
  if (new Set(keys).size !== keys.length) throw new TypeError(`${label} contains duplicates.`);
};
const validateDefinitionMap = (raw: unknown): void => {
  const value = record(raw, 'Composition checkpoint definition map');
  const lists = [
    'stateCodecs',
    'operations',
    'rules',
    'packs',
    'modules',
    'capabilities',
    'resources',
    'items',
    'recipes',
    'systems',
    'lifecycles',
  ] as const;
  exactKeys(value, lists, ['schemaVersion', 'voxels']);
  if (value.schemaVersion !== undefined && value.schemaVersion !== 2)
    throw new TypeError('Composition checkpoint definition map version is invalid.');
  for (const key of [...lists, ...(value.voxels === undefined ? [] : ['voxels' as const])])
    dense(value[key], `Composition checkpoint ${key}`);
  for (const rawRow of value.stateCodecs as readonly unknown[]) {
    const row = identityRow(rawRow, ['id', 'version', 'resource', 'moduleId'], ['partitions']);
    id(row.id, 'State codec id');
    version(row.version, 'State codec version');
    string(row.resource, 'State codec resource');
    id(row.moduleId, 'State codec module id');
    if (row.partitions !== undefined && (!Number.isSafeInteger(row.partitions) || (row.partitions as number) < 1))
      throw new TypeError('State codec partitions are invalid.');
  }
  for (const rawRow of value.operations as readonly unknown[]) {
    const row = identityRow(rawRow, ['id', 'resource', 'moduleId', 'executionKind']);
    id(row.id, 'Operation id');
    string(row.resource, 'Operation resource');
    id(row.moduleId, 'Operation module id');
    if (row.executionKind !== 'actor' && row.executionKind !== 'system')
      throw new TypeError('Operation execution kind is invalid.');
  }
  for (const rawRow of value.rules as readonly unknown[]) {
    const row = identityRow(rawRow, ['id', 'operationId', 'moduleId', 'stage']);
    id(row.id, 'Rule id');
    id(row.operationId, 'Rule operation id');
    id(row.moduleId, 'Rule module id');
    if (row.stage !== 'before' && row.stage !== 'after') throw new TypeError('Rule stage is invalid.');
  }
  for (const rawRow of value.packs as readonly unknown[]) {
    const row = identityRow(rawRow, ['id', 'version']);
    id(row.id, 'Pack definition id');
    version(row.version, 'Pack definition version');
  }
  for (const rawRow of value.modules as readonly unknown[]) {
    const row = identityRow(rawRow, ['id', 'version', 'packId']);
    id(row.id, 'Module id');
    version(row.version, 'Module version');
    id(row.packId, 'Module Pack id');
  }
  for (const rawRow of value.capabilities as readonly unknown[]) {
    const row = identityRow(rawRow, ['id', 'version', 'moduleId'], ['definitionIdentity']);
    id(row.id, 'Capability id');
    version(row.version, 'Capability version');
    id(row.moduleId, 'Capability module id');
    if (row.definitionIdentity !== undefined) string(row.definitionIdentity, 'Capability definition identity');
  }
  for (const rawRow of value.resources as readonly unknown[]) {
    const row = identityRow(rawRow, ['id', 'operations']);
    if (typeof row.id !== 'string' || !RESOURCE_ID.test(row.id)) throw new TypeError('Resource id is invalid.');
    validateOperationNames(row.operations, 'Resource operations');
  }
  for (const key of ['items', 'recipes'] as const)
    for (const rawRow of value[key] as readonly unknown[]) {
      const row = identityRow(rawRow, ['id', 'storageId']);
      id(row.id, `${key} id`);
      if (typeof row.storageId !== 'string' || !STORAGE_ID.test(row.storageId))
        throw new TypeError(`${key} storage id is invalid.`);
    }
  for (const rawRow of (value.voxels ?? []) as readonly unknown[]) {
    const row = identityRow(rawRow, ['id', 'storageId']);
    id(row.id, 'Voxel id');
    if (!Number.isSafeInteger(row.storageId) || (row.storageId as number) < 0 || (row.storageId as number) > 65_535)
      throw new TypeError('Voxel storage id is invalid.');
  }
  for (const rawRow of value.systems as readonly unknown[]) {
    const row = identityRow(rawRow, ['moduleId', 'definition']);
    id(row.moduleId, 'System module id');
    const definition = identityRow(
      row.definition,
      ['id', 'operationId', 'cadence', 'before', 'after'],
      ['intervalSeconds'],
    );
    id(definition.id, 'System id');
    id(definition.operationId, 'System operation id');
    if (definition.cadence !== 'interval' && definition.cadence !== 'every-advance')
      throw new TypeError('System cadence is invalid.');
    validateDependencyIds(definition.before, 'System before dependencies');
    validateDependencyIds(definition.after, 'System after dependencies');
    if (
      definition.intervalSeconds !== undefined &&
      (typeof definition.intervalSeconds !== 'number' || !Number.isFinite(definition.intervalSeconds))
    )
      throw new TypeError('System interval is invalid.');
  }
  for (const rawRow of value.lifecycles as readonly unknown[]) {
    const row = identityRow(rawRow, ['moduleId', 'definition']);
    id(row.moduleId, 'Lifecycle module id');
    const definition = identityRow(row.definition, [], ['startOperationId', 'stopOperationId']);
    if (definition.startOperationId === undefined && definition.stopOperationId === undefined)
      throw new TypeError('Lifecycle operation is missing.');
    if (definition.startOperationId !== undefined) id(definition.startOperationId, 'Lifecycle start operation id');
    if (definition.stopOperationId !== undefined) id(definition.stopOperationId, 'Lifecycle stop operation id');
  }
  for (const key of [
    'stateCodecs',
    'operations',
    'rules',
    'packs',
    'modules',
    'capabilities',
    'resources',
    'items',
    'recipes',
    'voxels',
  ] as const)
    if (value[key])
      uniqueRows(value[key] as readonly unknown[], (row) => String(row.id), `Composition checkpoint ${key}`);
  uniqueRows(
    value.systems as readonly unknown[],
    (row) => String(record(row.definition, 'System definition').id),
    'Composition checkpoint systems',
  );
  uniqueRows(
    value.lifecycles as readonly unknown[],
    (row) => String(row.moduleId),
    'Composition checkpoint lifecycles',
  );
};
const deepFreeze = <Value>(value: Value): Value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

export function cloneCompositionCheckpointIdentity(raw: unknown): CompositionCheckpointIdentity {
  const value = JSON.parse(canonicalCompositionCheckpointIdentity(raw)) as Record<string, unknown>;
  exactKeys(value, ['version', 'playbookId', 'packLock', 'definitionMap']);
  if (value.version !== 1) throw new TypeError('Composition checkpoint identity version is invalid.');
  id(value.playbookId, 'Composition checkpoint Playbook id');
  for (const rawPack of dense(value.packLock, 'Composition checkpoint Pack lock')) {
    const pack = record(rawPack, 'Composition checkpoint Pack');
    exactKeys(pack, ['id', 'version', 'integrity']);
    id(pack.id, 'Composition checkpoint Pack id');
    version(pack.version, 'Composition checkpoint Pack version');
    const integrity = record(pack.integrity, 'Composition checkpoint Pack integrity');
    exactKeys(integrity, ['algorithm', 'manifestDigest', 'entryDigest', 'resources']);
    if (
      integrity.algorithm !== 'sha256' ||
      !SHA256.test(String(integrity.manifestDigest)) ||
      !SHA256.test(String(integrity.entryDigest))
    )
      throw new TypeError('Composition checkpoint Pack integrity is invalid.');
    for (const rawResource of dense(integrity.resources, 'Composition checkpoint Pack resources')) {
      const resource = record(rawResource, 'Composition checkpoint Pack resource');
      exactKeys(resource, ['path', 'digest']);
      string(resource.path, 'Composition checkpoint Pack resource path');
      if (!SHA256.test(String(resource.digest)))
        throw new TypeError('Composition checkpoint Pack resource digest is invalid.');
    }
  }
  validateDefinitionMap(value.definitionMap);
  return deepFreeze(value) as CompositionCheckpointIdentity;
}

export const sameCompositionCheckpointIdentity = (left: unknown, right: unknown): boolean =>
  canonicalCompositionCheckpointIdentity(left) === canonicalCompositionCheckpointIdentity(right);

export function createCompositionCheckpointGuard(
  composition: WorldComposition,
  legacySourceIdentity?: CompositionCheckpointIdentity,
  declaredPredecessors: readonly GameplaySnapshotPredecessorV1[] = [],
) {
  const identity: CompositionCheckpointIdentity = {
    version: 1,
    playbookId: composition.playbookId,
    packLock: composition.packLock,
    definitionMap: composition.definitionMap,
  };
  const expected = canonicalData(identity);
  const inventoryPointerPredecessor =
    composition.playbookId === 'seedlands:overworld' &&
    identity.packLock.length === 1 &&
    identity.packLock[0]?.id === 'seedlands:overworld' &&
    identity.packLock[0].version === '1.0.0'
      ? canonicalData({
          ...identity,
          packLock: [
            {
              ...identity.packLock[0],
              integrity: {
                algorithm: 'sha256',
                ...INVENTORY_POINTER_PREDECESSOR_OVERWORLD,
                resources: [],
              },
            },
          ],
          definitionMap: (() => {
            const legacy = legacyContentDefinitionMap(identity.definitionMap);
            return {
              ...legacy,
              modules: legacy.modules.filter(({ id }) => id !== OVERWORLD_WORLDGEN_MODULE),
              capabilities: legacy.capabilities.filter(({ id }) => id !== WORLDGEN_PROVIDER_CAPABILITY),
            };
          })(),
        })
      : null;
  const kernelMigrationPredecessor =
    composition.playbookId === 'seedlands:overworld' &&
    identity.packLock.length === 1 &&
    identity.packLock[0]?.id === 'seedlands:overworld' &&
    identity.packLock[0].version === '1.0.0'
      ? canonicalData({
          ...identity,
          packLock: [
            {
              ...identity.packLock[0],
              integrity: {
                algorithm: 'sha256',
                ...KERNEL_MIGRATION_PREDECESSOR_OVERWORLD,
                resources: [],
              },
            },
          ],
          definitionMap: (() => {
            const legacy = legacyContentDefinitionMap(identity.definitionMap);
            return {
              ...legacy,
              modules: legacy.modules.filter(({ id }) => id !== OVERWORLD_WORLDGEN_MODULE),
              capabilities: legacy.capabilities.filter(({ id }) => id !== WORLDGEN_PROVIDER_CAPABILITY),
            };
          })(),
        })
      : null;
  const admitsNpcComposablePredecessor =
    composition.playbookId === 'seedlands:overworld' &&
    identity.packLock.length === 1 &&
    identity.packLock[0]?.id === 'seedlands:overworld' &&
    identity.packLock[0].version === '1.0.0' &&
    identity.definitionMap.modules.some(({ id }) => id === BEHAVIOR_REGISTRY_MODULE) &&
    identity.definitionMap.capabilities.some(({ id }) => id === BEHAVIOR_REGISTRY_CAPABILITY);
  const npcComposablePredecessor = admitsNpcComposablePredecessor
    ? canonicalData({
        ...identity,
        packLock: [
          {
            ...identity.packLock[0],
            integrity: {
              algorithm: 'sha256',
              ...NPC_COMPOSABLE_PREDECESSOR_OVERWORLD,
              resources: [],
            },
          },
        ],
        definitionMap: (() => {
          const legacy = legacyContentDefinitionMap(identity.definitionMap);
          return {
            ...legacy,
            modules: legacy.modules.filter(
              ({ id }) => id !== BEHAVIOR_REGISTRY_MODULE && id !== OVERWORLD_WORLDGEN_MODULE,
            ),
            capabilities: legacy.capabilities.filter(
              ({ id }) => id !== BEHAVIOR_REGISTRY_CAPABILITY && id !== WORLDGEN_PROVIDER_CAPABILITY,
            ),
          };
        })(),
      })
    : null;
  return Object.freeze({
    snapshot: (): CompositionCheckpointIdentity => JSON.parse(expected) as CompositionCheckpointIdentity,
    validateMigrationSource(raw: unknown) {
      if (!raw || typeof raw !== 'object' || !('version' in raw))
        throw new TypeError('Composition gameplay input is invalid.');
      const sourceVersion = raw.version as number;
      if ([1, 2, 3].includes(sourceVersion)) {
        if (!legacySourceIdentity) throw new TypeError('Legacy gameplay composition identity is unavailable.');
        const legacy = canonicalCompositionCheckpointIdentity(legacySourceIdentity);
        if (
          legacy !== inventoryPointerPredecessor &&
          legacy !== npcComposablePredecessor &&
          legacy !== kernelMigrationPredecessor &&
          !declaredPredecessors.some(
            (predecessor) =>
              predecessor.gameplayVersions.includes(sourceVersion as 1 | 2 | 3) &&
              canonicalCompositionCheckpointIdentity(predecessor.identity) === legacy,
          )
        )
          throw new TypeError('Legacy gameplay composition identity is not an approved predecessor.');
        return;
      }
      if (sourceVersion === 4 && 'composition' in raw) {
        const actual = canonicalCompositionCheckpointIdentity(raw.composition);
        if (
          actual === expected ||
          actual === inventoryPointerPredecessor ||
          actual === npcComposablePredecessor ||
          actual === kernelMigrationPredecessor ||
          declaredPredecessors.some(
            (predecessor) =>
              predecessor.gameplayVersions.includes(4) &&
              canonicalCompositionCheckpointIdentity(predecessor.identity) === actual,
          )
        )
          return;
      }
      throw new TypeError('Gameplay composition identity is missing or incompatible.');
    },
    validateGameplay(raw: unknown) {
      if (!raw || typeof raw !== 'object' || !('version' in raw))
        throw new TypeError('Composition gameplay input is invalid.');
      if ([1, 2, 3].includes(raw.version as number)) return this.validateMigrationSource(raw);
      if (!('composition' in raw)) throw new TypeError('Gameplay composition identity is missing or incompatible.');
      const actual = canonicalData(raw.composition);
      if (
        actual !== expected &&
        actual !== inventoryPointerPredecessor &&
        actual !== npcComposablePredecessor &&
        actual !== kernelMigrationPredecessor
      )
        throw new TypeError('Gameplay composition identity is missing or incompatible.');
    },
  });
}
