import { createContentRegistration } from './content-registration';
import { snapshotPackLock, snapshotOperationIdentity } from './composition-identity';
import { createOperationRegistration } from './operation-registration';
import { createLifecycleRegistration } from './lifecycle-registration';
import {
  BUILTIN_WORLD_RESOURCES,
  type WorldOperation,
  type WorldResourceRegistration,
} from '../harness/world-authorization';
import type {
  ArtifactIntegrityReceipt,
  AssembleWorldPackOptions,
  CapabilityContract,
  ModModule,
  ModModuleDescriptor,
  ModulePermission,
  PackDefinition,
  PackDefinitionInput,
  PackManifest,
  ProviderSelection,
  VerifiedPackArtifact,
  WorldComposition,
} from './contracts';

const SHA256 = /^[a-f0-9]{64}$/i;
const NAMESPACE_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const RESOURCE_ID = /^[a-z0-9][a-z0-9._:-]*$/;
const EXACT_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const OPERATIONS: readonly WorldOperation[] = ['read', 'execute', 'write', 'control', 'export', 'restore'];

const freezeArray = <Value>(values: readonly Value[]): readonly Value[] => Object.freeze([...values]);
const contractKey = (contract: CapabilityContract) => `${contract.id}@${contract.version}`;
const selectionKey = (selection: ProviderSelection) => `${selection.capability}\0${selection.moduleId}`;
const codeUnitCompare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const source = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(source)
      .filter((key) => source[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Pack descriptor must contain only JSON-compatible values.');
};

const assertId = (id: string, kind: string): void => {
  if (!NAMESPACE_ID.test(id)) throw new TypeError(`${kind} id must be namespace-qualified: ${id || '<empty>'}`);
};

const assertVersion = (version: string, kind: string): void => {
  if (!EXACT_VERSION.test(version))
    throw new TypeError(`${kind} version must use the initial exact-version contract: ${version || '<empty>'}`);
};

const freezePermission = (permission: ModulePermission): ModulePermission =>
  Object.freeze({ resource: permission.resource, operations: Object.freeze([...permission.operations]) });

const normalizeDescriptor = (descriptor: ModModuleDescriptor): ModModuleDescriptor =>
  Object.freeze({
    id: descriptor.id,
    version: descriptor.version,
    ...(descriptor.provides
      ? { provides: Object.freeze(descriptor.provides.map((entry) => Object.freeze({ ...entry }))) }
      : {}),
    ...(descriptor.requires
      ? { requires: Object.freeze(descriptor.requires.map((entry) => Object.freeze({ ...entry }))) }
      : {}),
    ...(descriptor.replaces
      ? { replaces: Object.freeze(descriptor.replaces.map((entry) => Object.freeze({ ...entry }))) }
      : {}),
    ...(descriptor.resources
      ? {
          resources: Object.freeze(
            descriptor.resources.map((entry) =>
              Object.freeze({ id: entry.id, operations: Object.freeze([...entry.operations]) }),
            ),
          ),
        }
      : {}),
    ...(descriptor.permissions ? { permissions: Object.freeze(descriptor.permissions.map(freezePermission)) } : {}),
  });

const assertUnique = (values: readonly string[], label: string): void => {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new TypeError(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
};

const validateOperations = (operations: readonly WorldOperation[], label: string): void => {
  if (operations.length === 0) throw new TypeError(`${label} operations must not be empty.`);
  assertUnique(operations, `${label} operation`);
  for (const operation of operations)
    if (!OPERATIONS.includes(operation)) throw new TypeError(`${label} operation is invalid: ${operation}`);
};

const validatePermissions = (permissions: readonly ModulePermission[], label: string): void => {
  assertUnique(
    permissions.map((permission) => permission.resource),
    `${label} permission resource`,
  );
  for (const permission of permissions) {
    if (!RESOURCE_ID.test(permission.resource))
      throw new TypeError(`${label} resource is invalid: ${permission.resource}`);
    validateOperations(permission.operations, `${label} ${permission.resource}`);
  }
};

const validateDescriptor = (descriptor: ModModuleDescriptor): void => {
  assertId(descriptor.id, 'Module');
  assertVersion(descriptor.version, `Module ${descriptor.id}`);
  for (const [label, contracts] of [
    ['provided capability', descriptor.provides ?? []],
    ['required capability', descriptor.requires ?? []],
    ['replacement capability', descriptor.replaces ?? []],
  ] as const) {
    assertUnique(
      contracts.map((contract) => contract.id),
      `${descriptor.id} ${label}`,
    );
    for (const contract of contracts) {
      assertId(contract.id, label);
      assertVersion(contract.version, `${descriptor.id} ${label}`);
    }
  }
  const resources = descriptor.resources ?? [];
  assertUnique(
    resources.map((resource) => resource.id),
    `${descriptor.id} resource`,
  );
  for (const resource of resources) {
    if (!RESOURCE_ID.test(resource.id)) throw new TypeError(`Module resource id is invalid: ${resource.id}`);
    validateOperations(resource.operations, `Module resource ${resource.id}`);
  }
  validatePermissions(descriptor.permissions ?? [], descriptor.id);
};

const validateManifest = (manifest: PackManifest): void => {
  if (manifest.schemaVersion !== 1) throw new TypeError(`Unsupported Pack manifest schema: ${manifest.schemaVersion}`);
  assertId(manifest.id, 'Pack');
  assertVersion(manifest.version, `Pack ${manifest.id}`);
  if (manifest.kind !== 'playbook' && manifest.kind !== 'extension')
    throw new TypeError(`Pack kind is invalid: ${String(manifest.kind)}`);
  if (!manifest.entry.trim()) throw new TypeError(`Pack entry is required: ${manifest.id}`);
  if (!Array.isArray(manifest.modules)) throw new TypeError(`Pack modules must be an array: ${manifest.id}`);
  assertUnique(
    manifest.modules.map((descriptor) => descriptor.id),
    `${manifest.id} module`,
  );
  manifest.modules.forEach(validateDescriptor);
  assertUnique(
    (manifest.dependencies ?? []).map((dependency) => dependency.id),
    `${manifest.id} dependency`,
  );
  for (const dependency of manifest.dependencies ?? []) {
    assertId(dependency.id, 'Pack dependency');
    assertVersion(dependency.version, `Pack dependency ${dependency.id}`);
  }
  assertUnique(manifest.resources ?? [], `${manifest.id} resource artifact`);
  for (const path of manifest.resources ?? [])
    if (!path.trim()) throw new TypeError('Resource path must not be empty.');
  const selections = manifest.providerSelections ?? [];
  assertUnique(
    selections.map((selection) => selection.capability),
    `${manifest.id} provider selection capability`,
  );
  for (const selection of selections) {
    assertId(selection.capability, 'Provider selection capability');
    assertId(selection.moduleId, 'Provider selection module');
  }
};

const validateIntegrity = (manifest: PackManifest, integrity: ArtifactIntegrityReceipt): void => {
  if (!integrity || typeof integrity !== 'object')
    throw new TypeError(`Pack integrity receipt is required before world creation: ${manifest.id}`);
  if (integrity.algorithm !== 'sha256') throw new TypeError(`Unsupported integrity algorithm: ${integrity.algorithm}`);
  if (!SHA256.test(integrity.manifestDigest) || !SHA256.test(integrity.entryDigest))
    throw new TypeError(`Pack integrity receipt contains an invalid digest: ${manifest.id}`);
  const expected = [...(manifest.resources ?? [])].sort();
  const actual = integrity.resources.map((resource) => resource.path).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    throw new TypeError(`Pack integrity receipt is missing or adds resources: ${manifest.id}`);
  for (const resource of integrity.resources)
    if (!SHA256.test(resource.digest)) throw new TypeError(`Resource digest is invalid: ${resource.path}`);
};

const stableTopologicalOrder = (
  ids: readonly string[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  label: string,
): readonly string[] => {
  const remaining = new Map(ids.map((id) => [id, new Set(dependencies.get(id) ?? [])]));
  const result: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter(([, deps]) => deps.size === 0)
      .map(([id]) => id)
      .sort();
    if (ready.length === 0)
      throw new TypeError(`${label} dependency cycle: ${[...remaining.keys()].sort().join(', ')}`);
    for (const id of ready) {
      result.push(id);
      remaining.delete(id);
      for (const deps of remaining.values()) deps.delete(id);
    }
  }
  return Object.freeze(result);
};

const permissionIncludes = (approved: readonly ModulePermission[], requested: ModulePermission): boolean =>
  approved.some(
    (grant) =>
      grant.resource === requested.resource &&
      requested.operations.every((operation) => grant.operations.includes(operation)),
  );

/** Defines Pack authoring data without claiming that any artifact bytes were verified. */
export function definePack(input: PackDefinitionInput): PackDefinition {
  const modules = freezeArray(input.modules ?? []);
  const manifest: PackManifest = Object.freeze({
    schemaVersion: 1,
    id: input.id,
    version: input.version,
    kind: input.kind,
    entry: input.entry ?? `./${input.id.replace(':', '-')}.mjs`,
    modules: Object.freeze(modules.map((entry) => entry.descriptor)),
    ...(input.dependencies ? { dependencies: freezeArray(input.dependencies) } : {}),
    ...(input.resources ? { resources: freezeArray(input.resources) } : {}),
    ...(input.providerSelections ? { providerSelections: freezeArray(input.providerSelections) } : {}),
  });
  return Object.freeze({ manifest, modules });
}

export function assembleWorldPacks(
  artifacts: readonly VerifiedPackArtifact[],
  options: AssembleWorldPackOptions = {},
): WorldComposition {
  const packById = new Map<string, VerifiedPackArtifact>();
  for (const artifact of artifacts) {
    validateManifest(artifact.manifest);
    validateIntegrity(artifact.manifest, artifact.integrity);
    if (packById.has(artifact.manifest.id)) throw new TypeError(`Duplicate Pack id: ${artifact.manifest.id}`);
    if (artifact.modules.length !== artifact.manifest.modules.length)
      throw new TypeError(`Pack module artifact count does not match manifest: ${artifact.manifest.id}`);
    const moduleById = new Map(artifact.modules.map((entry) => [entry.descriptor.id, entry]));
    for (const descriptor of artifact.manifest.modules) {
      const loaded = moduleById.get(descriptor.id);
      if (!loaded || canonicalJson(loaded.descriptor) !== canonicalJson(descriptor))
        throw new TypeError(`Loaded module does not match manifest: ${descriptor.id}`);
    }
    packById.set(
      artifact.manifest.id,
      Object.freeze({
        manifest: artifact.manifest,
        integrity: artifact.integrity,
        modules: Object.freeze(
          artifact.modules.map((entry) =>
            Object.freeze({ descriptor: normalizeDescriptor(entry.descriptor), register: entry.register }),
          ),
        ),
      }),
    );
  }
  const playbooks = artifacts.filter((artifact) => artifact.manifest.kind === 'playbook');
  if (playbooks.length !== 1)
    throw new TypeError(`A world requires exactly one Playbook; received ${playbooks.length}.`);

  const packDependencies = new Map<string, Set<string>>();
  for (const artifact of artifacts) {
    const dependencies = new Set<string>();
    for (const dependency of artifact.manifest.dependencies ?? []) {
      const provider = packById.get(dependency.id);
      if (!provider) throw new TypeError(`Missing Pack dependency: ${dependency.id}`);
      if (provider.manifest.version !== dependency.version)
        throw new TypeError(
          `Pack dependency version mismatch for ${dependency.id}: expected ${dependency.version}, got ${provider.manifest.version}`,
        );
      dependencies.add(dependency.id);
    }
    packDependencies.set(artifact.manifest.id, dependencies);
  }
  const packOrder = stableTopologicalOrder([...packById.keys()], packDependencies, 'Pack');

  const moduleById = new Map<string, { module: ModModule; packId: string }>();
  for (const packId of packOrder) {
    const artifact = packById.get(packId)!;
    for (const module of artifact.modules) {
      if (moduleById.has(module.descriptor.id)) throw new TypeError(`Duplicate module id: ${module.descriptor.id}`);
      moduleById.set(module.descriptor.id, { module, packId });
    }
  }

  const providers = new Map<string, { moduleId: string; version: string }[]>();
  for (const { module } of moduleById.values())
    for (const capability of module.descriptor.provides ?? []) {
      const values = providers.get(capability.id) ?? [];
      values.push({ moduleId: module.descriptor.id, version: capability.version });
      providers.set(capability.id, values);
    }
  const playbookSelections = new Map(
    (playbooks[0].manifest.providerSelections ?? []).map((selection) => [selection.capability, selection.moduleId]),
  );
  const approvals = new Set((options.approvedReplacements ?? []).map(selectionKey));
  const selectedProviders = new Map<string, { moduleId: string; version: string }>();
  for (const [capability, candidates] of providers) {
    if (candidates.length === 1) {
      selectedProviders.set(capability, candidates[0]);
      continue;
    }
    const selectedModuleId = playbookSelections.get(capability);
    const selected = candidates.find((candidate) => candidate.moduleId === selectedModuleId);
    const descriptor = selected ? moduleById.get(selected.moduleId)?.module.descriptor : undefined;
    const replacement = descriptor?.replaces?.find((entry) => entry.id === capability);
    const replacedVersionsMatch = Boolean(
      selected &&
      replacement &&
      candidates
        .filter((candidate) => candidate !== selected)
        .every((candidate) => candidate.version === replacement.version),
    );
    if (
      !selected ||
      !replacement ||
      !replacedVersionsMatch ||
      !approvals.has(selectionKey({ capability, moduleId: selected.moduleId }))
    )
      throw new TypeError(`Capability provider replacement is not explicitly selected and approved: ${capability}`);
    selectedProviders.set(capability, selected);
  }

  const moduleDependencies = new Map<string, Set<string>>();
  for (const [moduleId, { module }] of moduleById) {
    const dependencies = new Set<string>();
    for (const requirement of module.descriptor.requires ?? []) {
      const provider = selectedProviders.get(requirement.id);
      if (!provider) throw new TypeError(`Missing capability provider: ${contractKey(requirement)}`);
      if (provider.version !== requirement.version)
        throw new TypeError(
          `Capability version mismatch for ${requirement.id}: expected ${requirement.version}, got ${provider.version}`,
        );
      if (provider.moduleId !== moduleId) dependencies.add(provider.moduleId);
    }
    moduleDependencies.set(moduleId, dependencies);
  }
  const moduleOrder = stableTopologicalOrder([...moduleById.keys()], moduleDependencies, 'Module');

  const resourceById = new Map<string, WorldResourceRegistration>();
  for (const { module } of moduleById.values())
    for (const resource of module.descriptor.resources ?? []) {
      if (BUILTIN_WORLD_RESOURCES.includes(resource.id as (typeof BUILTIN_WORLD_RESOURCES)[number]))
        throw new TypeError(`Module cannot replace a built-in world resource: ${resource.id}`);
      if (resourceById.has(resource.id)) throw new TypeError(`Duplicate module resource: ${resource.id}`);
      resourceById.set(resource.id, Object.freeze({ id: resource.id, operations: freezeArray(resource.operations) }));
    }
  const knownResources = new Set<string>([...BUILTIN_WORLD_RESOURCES, ...resourceById.keys()]);
  const moduleBindings: Record<string, { packId: string; permissions: readonly ModulePermission[] }> = {};
  for (const [moduleId, { module, packId }] of moduleById) {
    const approved = options.approvedPermissions?.[packId] ?? [];
    for (const permission of module.descriptor.permissions ?? []) {
      if (!knownResources.has(permission.resource))
        throw new TypeError(`Permission references unknown resource: ${permission.resource}`);
      if (!permissionIncludes(approved, permission))
        throw new TypeError(`Pack permission was not approved by the host: ${packId} -> ${permission.resource}`);
    }
    moduleBindings[moduleId] = Object.freeze({
      packId,
      permissions: Object.freeze((module.descriptor.permissions ?? []).map(freezePermission)),
    });
  }

  const operationRegistration = createOperationRegistration(knownResources);
  const lifecycleRegistration = createLifecycleRegistration();
  const capabilityValues = new Map<string, unknown>();
  const contentRegistration = createContentRegistration();
  const { items, recipes } = contentRegistration;
  const finalizers: (() => void)[] = [];
  let definitionsReady = false;
  for (const moduleId of moduleOrder) {
    const binding = moduleById.get(moduleId)!;
    const module = binding.module;
    const provided = new Set((module.descriptor.provides ?? []).map((entry) => entry.id));
    const required = new Set((module.descriptor.requires ?? []).map((entry) => entry.id));
    let registrationOpen = true;
    const assertRegistrationOpen = (): void => {
      if (!registrationOpen) throw new TypeError(`Module registration facade is closed: ${moduleId}`);
    };
    const facade = Object.freeze({
      identity: Object.freeze({
        moduleId,
        moduleVersion: module.descriptor.version,
        packId: binding.packId,
      }),
      readContentDefinitions() {
        if (!definitionsReady) throw new TypeError('Content definitions are not ready during registration.');
        return Object.freeze({
          items: Object.freeze([...items.values()]),
          recipes: Object.freeze([...recipes.values()]),
        });
      },
      onDefinitionsReady(finalize: () => void) {
        assertRegistrationOpen();
        if (typeof finalize !== 'function') throw new TypeError('Definition finalizer must be a function.');
        finalizers.push(finalize);
      },
      ...operationRegistration.facade(moduleId, assertRegistrationOpen),
      ...lifecycleRegistration.facade(moduleId, assertRegistrationOpen),
      ...contentRegistration.facade(assertRegistrationOpen),
      provideCapability<Value>(id: string, value: Value): void {
        assertRegistrationOpen();
        if (!provided.has(id)) throw new TypeError(`Module ${moduleId} did not declare provided capability: ${id}`);
        if (selectedProviders.get(id)?.moduleId !== moduleId) return;
        if (capabilityValues.has(id)) throw new TypeError(`Capability was provided twice: ${id}`);
        capabilityValues.set(id, value);
      },
      requireCapability<Value>(id: string): Value {
        assertRegistrationOpen();
        if (!required.has(id)) throw new TypeError(`Module ${moduleId} did not declare required capability: ${id}`);
        if (!capabilityValues.has(id)) throw new TypeError(`Required capability was not registered before use: ${id}`);
        return capabilityValues.get(id) as Value;
      },
    });
    try {
      module.register(facade);
    } finally {
      registrationOpen = false;
    }
    for (const capability of module.descriptor.provides ?? [])
      if (selectedProviders.get(capability.id)?.moduleId === moduleId && !capabilityValues.has(capability.id))
        throw new TypeError(`Module did not register its declared capability: ${capability.id}`);
  }

  const resources = Object.freeze([...resourceById.values()].sort((a, b) => codeUnitCompare(a.id, b.id)));
  const registeredOperations = operationRegistration.finish();
  const registeredLifecycle = lifecycleRegistration.finish(moduleOrder, registeredOperations.operations);
  definitionsReady = true;
  for (const finalize of finalizers) finalize();
  const definitionMap = Object.freeze({
    ...snapshotOperationIdentity(registeredOperations),
    packs: Object.freeze(packOrder.map((id) => Object.freeze({ id, version: packById.get(id)!.manifest.version }))),
    modules: Object.freeze(
      moduleOrder.map((id) => {
        const binding = moduleById.get(id)!;
        return Object.freeze({ id, version: binding.module.descriptor.version, packId: binding.packId });
      }),
    ),
    capabilities: Object.freeze(
      [...selectedProviders]
        .sort(([a], [b]) => codeUnitCompare(a, b))
        .map(([id, provider]) => Object.freeze({ id, version: provider.version, moduleId: provider.moduleId })),
    ),
    resources,
    items: Object.freeze(
      [...items.values()]
        .sort((a, b) => codeUnitCompare(a.id, b.id))
        .map((item) => Object.freeze({ id: item.id, storageId: item.storageId ?? item.id })),
    ),
    recipes: Object.freeze(
      [...recipes.values()]
        .sort((a, b) => codeUnitCompare(a.id, b.id))
        .map((recipe) => Object.freeze({ id: recipe.id, storageId: recipe.storageId ?? recipe.id })),
    ),
    systems: registeredLifecycle.systems,
    lifecycles: registeredLifecycle.lifecycles,
  });
  return Object.freeze({
    capability<Value>(id: string): Value {
      if (!capabilityValues.has(id)) throw new TypeError(`World capability is not registered: ${id}`);
      return capabilityValues.get(id) as Value;
    },
    playbookId: playbooks[0].manifest.id,
    packLock: snapshotPackLock(packOrder.map((id) => packById.get(id)!)),
    packOrder,
    moduleOrder,
    definitionMap,
    resources,
    registrations: Object.freeze({
      ...registeredOperations,
      ...registeredLifecycle,
      items: Object.freeze([...items.values()].sort((a, b) => codeUnitCompare(a.id, b.id))),
      recipes: Object.freeze([...recipes.values()].sort((a, b) => codeUnitCompare(a.id, b.id))),
    }),
    moduleBindings: Object.freeze(moduleBindings),
  });
}

export function createWorldFromPacks<World>(
  artifacts: readonly VerifiedPackArtifact[],
  options: AssembleWorldPackOptions,
  create: (composition: WorldComposition) => World,
): World {
  return create(assembleWorldPacks(artifacts, options));
}
