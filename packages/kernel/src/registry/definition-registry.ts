import type {
  FrozenKernelDefinitions,
  KernelComponentDefinition,
  KernelExclusiveProviderDefinition,
  KernelModuleDefinition,
  KernelModuleStateDefinition,
  KernelRegistrationFacet,
  KernelSystemDefinition,
} from './contracts';

const STABLE_ID = /^[a-z0-9][a-z0-9_-]*(?::|\.)[a-z0-9][a-z0-9._/-]*$/;

const assertStableId = (value: string, label: string) => {
  if (!STABLE_ID.test(value)) throw new TypeError(`${label} must be a stable namespace id: ${value}`);
};

const sortSystems = (systems: readonly KernelSystemDefinition[]): readonly KernelSystemDefinition[] => {
  const byId = new Map(systems.map((system) => [system.id, system]));
  const permanent = new Set<string>();
  const visiting = new Set<string>();
  const result: KernelSystemDefinition[] = [];
  const visit = (system: KernelSystemDefinition) => {
    if (permanent.has(system.id)) return;
    if (visiting.has(system.id)) throw new TypeError(`Kernel system dependency cycle includes ${system.id}.`);
    visiting.add(system.id);
    for (const dependency of [...(system.after ?? [])].sort()) {
      const target = byId.get(dependency);
      if (!target) throw new TypeError(`Kernel system ${system.id} requires unknown system ${dependency}.`);
      if (target.phase > system.phase)
        throw new TypeError(`Kernel system ${system.id} cannot run after a later phase system ${dependency}.`);
      visit(target);
    }
    visiting.delete(system.id);
    permanent.add(system.id);
    result.push(system);
  };
  for (const system of [...systems].sort(
    (left, right) => left.phase - right.phase || left.order - right.order || left.id.localeCompare(right.id),
  ))
    visit(system);
  return Object.freeze(result);
};

const sortModules = (modules: ReadonlyMap<string, KernelModuleDefinition>): readonly KernelModuleDefinition[] => {
  const ordered: KernelModuleDefinition[] = [];
  const permanent = new Set<string>();
  const visiting = new Set<string>();
  const visit = (module: KernelModuleDefinition) => {
    if (permanent.has(module.id)) return;
    if (visiting.has(module.id)) throw new TypeError(`Kernel module dependency cycle includes ${module.id}.`);
    visiting.add(module.id);
    for (const dependency of [...(module.requiredModules ?? [])].sort()) {
      const target = modules.get(dependency);
      if (!target) throw new TypeError(`Kernel module ${module.id} requires missing module ${dependency}.`);
      visit(target);
    }
    visiting.delete(module.id);
    permanent.add(module.id);
    ordered.push(module);
  };
  for (const module of [...modules.values()].sort((left, right) => left.id.localeCompare(right.id))) visit(module);
  return Object.freeze(ordered);
};

const facetIdentity = (values: readonly KernelRegistrationFacet[]) =>
  values
    .map(({ id, moduleId, version, dependencies, definition }) => ({
      id,
      moduleId,
      version,
      dependencies: [...(dependencies ?? [])].sort(),
      ...(definition === undefined ? {} : { definition }),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

const identityFor = (modules: readonly KernelModuleDefinition[], systems: readonly KernelSystemDefinition[]) =>
  JSON.stringify({
    schemaVersion: 2,
    modules: modules.map((module) => ({
      id: module.id,
      version: module.version,
      requiredModules: [...(module.requiredModules ?? [])].sort(),
      components: [...(module.components ?? [])]
        .map((component) => ({
          id: component.id,
          codecVersion: component.codec.version,
          dependencies: [...(component.dependencies ?? [])].sort(),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      moduleStates: [...(module.moduleStates ?? [])]
        .map((state) => ({
          id: state.id,
          codecVersion: state.codec.version,
          dependencies: [...(state.dependencies ?? [])].sort(),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      stateCodecs: facetIdentity(module.stateCodecs ?? []),
      systemDefinitions: facetIdentity(module.systemDefinitions ?? []),
      operations: facetIdentity(module.operations ?? []),
      rules: facetIdentity(module.rules ?? []),
      resources: facetIdentity(module.resources ?? []),
      capabilities: facetIdentity(module.capabilities ?? []),
      providers: [...(module.providers ?? [])]
        .map((provider) => ({
          ...facetIdentity([provider])[0],
          capabilityId: provider.capabilityId,
          configurationIdentity: provider.configurationIdentity,
          artifactIdentity: provider.artifactIdentity,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    })),
    systems: systems.map(({ id, moduleId, phase, order, after }) => ({
      id,
      moduleId,
      phase,
      order,
      after: [...(after ?? [])].sort(),
    })),
  });

export function createKernelDefinitionRegistry() {
  const modules = new Map<string, KernelModuleDefinition>();
  let frozen = false;
  return Object.freeze({
    register(module: KernelModuleDefinition): void {
      if (frozen) throw new Error('Kernel definitions are already frozen.');
      assertStableId(module.id, 'Kernel module id');
      if (!module.version) throw new TypeError(`Kernel module ${module.id} requires a version.`);
      if (modules.has(module.id)) throw new TypeError(`Duplicate Kernel module id: ${module.id}`);
      modules.set(module.id, module);
    },
    freeze(): FrozenKernelDefinitions {
      if (frozen) throw new Error('Kernel definitions are already frozen.');
      frozen = true;
      const orderedModules = sortModules(modules);
      const components = new Map<string, KernelComponentDefinition>();
      const moduleStates = new Map<string, KernelModuleStateDefinition>();
      const stateCodecs = new Map<string, KernelRegistrationFacet>();
      const systems = new Map<string, KernelSystemDefinition>();
      const systemDefinitions = new Map<string, KernelRegistrationFacet>();
      const operations = new Map<string, KernelRegistrationFacet>();
      const rules = new Map<string, KernelRegistrationFacet>();
      const resources = new Map<string, KernelRegistrationFacet>();
      const capabilities = new Map<string, KernelRegistrationFacet>();
      const providers = new Map<string, KernelExclusiveProviderDefinition>();
      const assertDependencies = (id: string, dependencies: readonly string[] = []) => {
        for (const dependency of dependencies)
          if (!modules.has(dependency))
            throw new TypeError(`Kernel definition ${id} requires missing module ${dependency}.`);
      };
      const collectFacets = <Facet extends KernelRegistrationFacet>(
        module: KernelModuleDefinition,
        values: readonly Facet[],
        target: Map<string, Facet>,
        label: string,
      ) => {
        for (const value of values) {
          assertStableId(value.id, `Kernel ${label} id`);
          if (value.moduleId !== module.id) throw new TypeError(`Kernel ${label} ${value.id} has a mismatched owner.`);
          if (!value.version) throw new TypeError(`Kernel ${label} ${value.id} requires a version.`);
          assertDependencies(value.id, value.dependencies);
          if (target.has(value.id)) throw new TypeError(`Duplicate Kernel ${label} id: ${value.id}`);
          target.set(value.id, value);
        }
      };
      for (const module of orderedModules) {
        for (const component of module.components ?? []) {
          assertStableId(component.id, 'Kernel component id');
          if (component.moduleId !== module.id)
            throw new TypeError(`Kernel component ${component.id} has a mismatched owner.`);
          if (!Number.isSafeInteger(component.codec.version) || component.codec.version <= 0)
            throw new TypeError(`Kernel component ${component.id} has an invalid codec version.`);
          if (typeof component.storage !== 'function')
            throw new TypeError(`Kernel component ${component.id} requires a storage factory.`);
          if (components.has(component.id)) throw new TypeError(`Duplicate Kernel component id: ${component.id}`);
          for (const dependency of component.dependencies ?? [])
            if (!modules.has(dependency))
              throw new TypeError(`Kernel component ${component.id} requires missing module ${dependency}.`);
          components.set(component.id, component);
        }
        for (const state of module.moduleStates ?? []) {
          assertStableId(state.id, 'Kernel module state id');
          if (state.moduleId !== module.id)
            throw new TypeError(`Kernel module state ${state.id} has a mismatched owner.`);
          if (!Number.isSafeInteger(state.codec.version) || state.codec.version <= 0)
            throw new TypeError(`Kernel module state ${state.id} has an invalid codec version.`);
          if (typeof state.create !== 'function' || typeof state.dispose !== 'function')
            throw new TypeError(`Kernel module state ${state.id} requires lifecycle factories.`);
          assertDependencies(state.id, state.dependencies);
          if (moduleStates.has(state.id)) throw new TypeError(`Duplicate Kernel module state id: ${state.id}`);
          moduleStates.set(state.id, state);
        }
        for (const system of module.systems ?? []) {
          assertStableId(system.id, 'Kernel system id');
          if (system.moduleId !== module.id) throw new TypeError(`Kernel system ${system.id} has a mismatched owner.`);
          if (!Number.isSafeInteger(system.phase) || !Number.isSafeInteger(system.order))
            throw new TypeError(`Kernel system ${system.id} has invalid scheduling fields.`);
          if (systems.has(system.id)) throw new TypeError(`Duplicate Kernel system id: ${system.id}`);
          systems.set(system.id, system);
        }
        collectFacets(module, module.operations ?? [], operations, 'operation');
        collectFacets(module, module.systemDefinitions ?? [], systemDefinitions, 'system definition');
        collectFacets(module, module.stateCodecs ?? [], stateCodecs, 'state codec');
        collectFacets(module, module.rules ?? [], rules, 'rule');
        collectFacets(module, module.resources ?? [], resources, 'resource');
        collectFacets(module, module.capabilities ?? [], capabilities, 'capability');
        collectFacets(module, module.providers ?? [], providers, 'provider');
      }
      const providerCapabilities = new Set<string>();
      for (const provider of providers.values()) {
        assertStableId(provider.capabilityId, 'Kernel provider capability id');
        if (!capabilities.has(provider.capabilityId))
          throw new TypeError(`Kernel provider ${provider.id} requires missing capability ${provider.capabilityId}.`);
        if (providerCapabilities.has(provider.capabilityId))
          throw new TypeError(`Kernel capability ${provider.capabilityId} has multiple exclusive providers.`);
        providerCapabilities.add(provider.capabilityId);
      }
      const orderedSystems = sortSystems([...systems.values()]);
      return Object.freeze({
        modules: Object.freeze(orderedModules),
        components,
        moduleStates,
        stateCodecs,
        systems: orderedSystems,
        systemDefinitions,
        operations,
        rules,
        resources,
        capabilities,
        providers,
        definitionIdentity: identityFor(orderedModules, orderedSystems),
      });
    },
  });
}
