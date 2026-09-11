import type { ModModule, ModuleInvocationValue } from '../../composition/contracts';
import type { ItemDefinitionRegistry } from '../item-registry';
import { validateActorModeFacets } from '../ecs-actor-state';
import type { ActorModeSnapshotFacets } from '../ecs-actor-components';

import {
  RULESET_COMPONENT,
  RULESET_RESOURCE,
  validateWorldRuleset,
  type WorldRulesetDefinition,
} from './ruleset-module';

const RESOURCE = 'seedlands.mode';
export const MODE_COMPONENT = 'seedlands:actor-mode';
const data = (value: ModuleInvocationValue | undefined): Readonly<Record<string, ModuleInvocationValue>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Mode input must be an object.');
  return value as Readonly<Record<string, ModuleInvocationValue>>;
};
export function defineModeModule(): ModModule {
  return Object.freeze({
    descriptor: {
      id: 'seedlands:mode-module',
      version: '1.0.0',
      requires: [
        { id: 'seedlands:items', version: '1.0.0' },
        { id: RULESET_COMPONENT, version: '1.0.0' },
      ],
      provides: [{ id: 'seedlands:actor-modes', version: '1.0.0' }],
      resources: [{ id: RESOURCE, operations: ['read', 'write', 'execute'] }],
      permissions: [
        { resource: RESOURCE, operations: ['read', 'write', 'execute'] },
        { resource: RULESET_RESOURCE, operations: ['read'] },
      ],
    },
    register(api) {
      const items = api.requireCapability<ItemDefinitionRegistry>('seedlands:items');
      const ruleset = api.requireCapability<WorldRulesetDefinition>(RULESET_COMPONENT);
      api.provideCapability(
        'seedlands:actor-modes',
        Object.freeze({
          setMode: 'seedlands:set-mode',
          setCatalog: 'seedlands:set-creative-catalog',
          setFlight: 'seedlands:set-flight',
        }),
      );
      api.registerState({
        id: MODE_COMPONENT,
        version: '1.0.0',
        resource: RESOURCE,
        validate(value) {
          try {
            const facets = data(value);
            if (!facets.mode || !facets.creativeCatalog || !facets.flight) return false;
            validateActorModeFacets(facets as ActorModeSnapshotFacets, items);
            return true;
          } catch {
            return false;
          }
        },
      });
      for (const operation of ['set-mode', 'set-creative-catalog', 'set-flight'] as const) {
        api.registerOperation({
          id: `seedlands:${operation}`,
          resource: RESOURCE,
          run(context, input, state) {
            if (context.target.kind !== 'entity' || context.target.entityId !== context.originalActorId)
              throw new TypeError('Mode target must match the bound actor.');
            validateWorldRuleset(state.read({ componentId: RULESET_COMPONENT, target: { kind: 'world' } }), ruleset);
            const address = { componentId: MODE_COMPONENT, target: context.target };
            const current = validateActorModeFacets(data(state.read(address)) as ActorModeSnapshotFacets, items);
            const args = data(input);
            let { mode, creativeCatalog, flight } = current;
            if (operation === 'set-mode') {
              if (args.mode !== 'survival' && args.mode !== 'creative') throw new TypeError('Unknown actor mode.');
              if (args.mode === mode.value) throw new TypeError('Actor is already in the requested mode.');
              mode = { ...mode, value: args.mode, revision: mode.revision + 1 };
              flight = {
                ...flight,
                enabled: args.mode === 'creative',
                revision: flight.revision + Number(flight.enabled !== (args.mode === 'creative')),
              };
              if (args.mode === 'creative') {
                const initial = items
                  .list()
                  .filter((item) => item.capabilities.some((capability) => capability.type === 'place'))
                  .slice(0, 8)
                  .map((item) => item.id);
                const hotbar = creativeCatalog.hotbar.some((id) => id !== null)
                  ? creativeCatalog.hotbar
                  : Array.from({ length: 8 }, (_, index) => initial[index] ?? null);
                creativeCatalog = { ...creativeCatalog, hotbar, revision: creativeCatalog.revision + 1 };
              }
            } else {
              if (mode.value !== 'creative') throw new TypeError('Creative controls require creative mode.');
              if (operation === 'set-flight') {
                if (typeof args.enabled !== 'boolean') throw new TypeError('Flight enabled must be boolean.');
                flight = {
                  ...flight,
                  enabled: args.enabled,
                  revision: flight.revision + Number(flight.enabled !== args.enabled),
                };
              } else {
                if (
                  typeof args.slot !== 'number' ||
                  !Number.isSafeInteger(args.slot) ||
                  args.slot < 0 ||
                  args.slot >= 8 ||
                  (args.itemId !== null && (typeof args.itemId !== 'string' || !items.has(args.itemId)))
                )
                  throw new TypeError('Creative catalog selection is invalid.');
                const hotbar = [...creativeCatalog.hotbar];
                hotbar[args.slot] = args.itemId;
                creativeCatalog = {
                  ...creativeCatalog,
                  hotbar,
                  selectedSlot: args.slot,
                  revision: creativeCatalog.revision + 1,
                };
              }
            }
            const candidate = validateActorModeFacets({ mode, creativeCatalog, flight }, items);
            state.write(address, candidate);
            return { mode: candidate.mode.value, modeRevision: candidate.mode.revision };
          },
        });
      }
    },
  } satisfies ModModule);
}
