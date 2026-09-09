import type { ModLifecycleDefinition, ModSystemDefinition, LifecycleRegistrations } from './lifecycle-contracts';
import type { ModOperationDefinition, ModuleOwned } from './operation-contracts';

const SYSTEM_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const TIME_SCALE = 1e9;
const MIN_INTERVAL_UNITS = 1e6;

const denseDependencies = (value: readonly string[] | undefined, label: string): readonly string[] => {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || !value.every((_, index) => Object.hasOwn(value, index)))
    throw new TypeError(`System ${label} dependencies must be a dense array.`);
  const dependencies = value.map((id) => {
    if (typeof id !== 'string' || !SYSTEM_ID.test(id)) throw new TypeError(`Invalid system ${label} dependency.`);
    return id;
  });
  if (new Set(dependencies).size !== dependencies.length) throw new TypeError(`Duplicate system ${label} dependency.`);
  return Object.freeze(dependencies);
};

const normalizeSystem = (definition: ModSystemDefinition): ModSystemDefinition => {
  const cadence = definition.cadence ?? 'interval';
  const before = denseDependencies(definition.before, 'before');
  const after = denseDependencies(definition.after, 'after');
  if (before.some((id) => after.includes(id))) throw new TypeError(`Conflicting system dependency: ${definition.id}`);
  if (cadence === 'every-advance') {
    if (definition.intervalSeconds !== undefined)
      throw new TypeError(`Every-advance system cannot define an interval: ${definition.id}`);
    return Object.freeze({ ...definition, cadence, before, after });
  }
  if (cadence !== 'interval') throw new TypeError(`Unknown system cadence: ${definition.id}`);
  if (typeof definition.intervalSeconds !== 'number')
    throw new TypeError(`System interval must be a safe value of at least one millisecond: ${definition.id}`);
  const units = Math.round(definition.intervalSeconds * TIME_SCALE);
  if (!Number.isSafeInteger(units) || units < MIN_INTERVAL_UNITS)
    throw new TypeError(`System interval must be a safe value of at least one millisecond: ${definition.id}`);
  return Object.freeze({ ...definition, cadence, intervalSeconds: units / TIME_SCALE, before, after });
};

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
          if (!SYSTEM_ID.test(definition.id) || systems.has(definition.id))
            throw new TypeError(`Invalid or duplicate system: ${definition.id}`);
          systems.set(
            definition.id,
            Object.freeze({
              moduleId,
              definition: normalizeSystem(definition),
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
        if (operations.find((entry) => entry.definition.id === operationId)?.definition.executionKind !== 'system')
          throw new TypeError(`Lifecycle requires a system operation: ${operationId}`);
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
