import type {
  ModOperationDefinition,
  ModRuleDefinition,
  ModStateDefinition,
  ModuleOwned,
  OperationRegistrations,
} from './operation-contracts';

const namespace = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const version =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function createOperationRegistration(resources: ReadonlySet<string>) {
  const states = new Map<string, ModuleOwned<ModStateDefinition>>();
  const operations = new Map<string, ModuleOwned<ModOperationDefinition>>();
  const rules = new Map<string, ModuleOwned<ModRuleDefinition>>();
  const identity = (id: string, existing: ReadonlyMap<string, unknown>) => {
    if (!namespace.test(id) || existing.has(id)) throw new TypeError(`Invalid or duplicate registration: ${id}`);
  };
  const resource = (id: string) => {
    if (!resources.has(id)) throw new TypeError(`Unknown registered resource: ${id}`);
  };
  return {
    facade(moduleId: string, assertOpen: () => void) {
      return {
        registerState(definition: ModStateDefinition) {
          assertOpen();
          identity(definition.id, states);
          resource(definition.resource);
          if (!version.test(definition.version) || typeof definition.validate !== 'function')
            throw new TypeError('State codec is invalid.');
          states.set(definition.id, Object.freeze({ moduleId, definition: Object.freeze({ ...definition }) }));
        },
        registerOperation(definition: ModOperationDefinition) {
          assertOpen();
          identity(definition.id, operations);
          resource(definition.resource);
          if (typeof definition.run !== 'function') throw new TypeError('Operation executor is missing.');
          operations.set(definition.id, Object.freeze({ moduleId, definition: Object.freeze({ ...definition }) }));
        },
        registerRule(definition: ModRuleDefinition) {
          assertOpen();
          identity(definition.id, rules);
          if (typeof definition.apply !== 'function') throw new TypeError('Rule executor is missing.');
          rules.set(
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
    finish(): OperationRegistrations {
      const dependencies = new Map<string, Set<string>>();
      for (const [id, { definition }] of rules) {
        if (!operations.has(definition.operationId)) throw new TypeError(`Rule references unknown operation: ${id}`);
        dependencies.set(id, new Set(definition.after));
        for (const peer of [...(definition.before ?? []), ...(definition.after ?? [])]) {
          if (!rules.has(peer) || rules.get(peer)!.definition.operationId !== definition.operationId)
            throw new TypeError(`Rule dependency is missing or belongs to another operation: ${id} -> ${peer}`);
        }
      }
      for (const [id, { definition }] of rules)
        for (const next of definition.before ?? []) dependencies.get(next)!.add(id);
      const sortedRules: ModuleOwned<ModRuleDefinition>[] = [];
      while (dependencies.size) {
        const ready = [...dependencies]
          .filter(([, peers]) => peers.size === 0)
          .map(([id]) => id)
          .sort();
        if (!ready.length) throw new TypeError('Rule dependency cycle.');
        for (const id of ready) {
          sortedRules.push(rules.get(id)!);
          dependencies.delete(id);
          for (const peers of dependencies.values()) peers.delete(id);
        }
      }
      const ordered = <T>(map: ReadonlyMap<string, T>) =>
        Object.freeze([...map.keys()].sort().map((id) => map.get(id)!));
      return Object.freeze({
        states: ordered(states),
        operations: ordered(operations),
        rules: Object.freeze(sortedRules),
      });
    },
  };
}
