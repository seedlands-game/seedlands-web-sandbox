import type { ModLifecycleDefinition, ModSystemDefinition, LifecycleRegistrations } from './lifecycle-contracts';
import type { ModOperationDefinition, ModuleOwned } from './operation-contracts';

export function createLifecycleRegistration() {
  const lifecycles = new Map<string, ModuleOwned<ModLifecycleDefinition>>();
  const systems = new Map<string, ModuleOwned<ModSystemDefinition>>();
  return {
    facade(moduleId: string, assertOpen: () => void) {
      return {
        registerLifecycle(definition: ModLifecycleDefinition) {
          assertOpen();
          if (lifecycles.has(moduleId) || (!definition.startOperationId && !definition.stopOperationId))
            throw new TypeError(`Invalid or duplicate module lifecycle: ${moduleId}`);
          lifecycles.set(moduleId, Object.freeze({ moduleId, definition: Object.freeze({ ...definition }) }));
        },
        registerSystem(definition: ModSystemDefinition) {
          assertOpen();
          if (!/^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/.test(definition.id) || systems.has(definition.id))
            throw new TypeError(`Invalid or duplicate system: ${definition.id}`);
          if (!Number.isFinite(definition.intervalSeconds) || definition.intervalSeconds < 0.001)
            throw new TypeError(`System interval must be at least one millisecond: ${definition.id}`);
          systems.set(
            definition.id,
            Object.freeze({
              moduleId,
              definition: Object.freeze({
                ...definition,
                before: Object.freeze([...(definition.before ?? [])]),
                after: Object.freeze([...(definition.after ?? [])]),
              }),
            }),
          );
        },
      };
    },
    finish(
      moduleOrder: readonly string[],
      operations: readonly ModuleOwned<ModOperationDefinition>[],
    ): LifecycleRegistrations {
      const operationOwners = new Map(operations.map(({ moduleId, definition }) => [definition.id, moduleId]));
      const assertOwner = (moduleId: string, operationId: string) => {
        if (operationOwners.get(operationId) !== moduleId)
          throw new TypeError(`Lifecycle operation is missing or belongs to another module: ${operationId}`);
      };
      for (const { moduleId, definition } of lifecycles.values())
        for (const operationId of [definition.startOperationId, definition.stopOperationId])
          if (operationId) assertOwner(moduleId, operationId);
      const dependencies = new Map<string, Set<string>>();
      for (const [id, { moduleId, definition }] of systems) {
        assertOwner(moduleId, definition.operationId);
        dependencies.set(id, new Set(definition.after));
        for (const dependency of [...(definition.before ?? []), ...(definition.after ?? [])])
          if (!systems.has(dependency)) throw new TypeError(`Unknown system dependency: ${dependency}`);
      }
      for (const [id, { definition }] of systems)
        for (const next of definition.before ?? []) dependencies.get(next)!.add(id);
      const sorted: ModuleOwned<ModSystemDefinition>[] = [];
      while (dependencies.size) {
        const ready = [...dependencies]
          .filter(([, value]) => !value.size)
          .map(([id]) => id)
          .sort();
        if (!ready.length) throw new TypeError('System dependency cycle.');
        for (const id of ready) {
          sorted.push(systems.get(id)!);
          dependencies.delete(id);
          for (const values of dependencies.values()) values.delete(id);
        }
      }
      return Object.freeze({
        lifecycles: Object.freeze(moduleOrder.flatMap((id) => (lifecycles.has(id) ? [lifecycles.get(id)!] : []))),
        systems: Object.freeze(sorted),
      });
    },
  };
}
