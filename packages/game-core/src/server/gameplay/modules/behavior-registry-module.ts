import type { CapabilityContract, ModModule, ModulePermission } from '../../composition/contracts';
import {
  BEHAVIOR_REGISTRY_CAPABILITY,
  STANDARD_BEHAVIOR_PROVIDER_MODULE_ID,
  createBehaviorCapabilityRegistry,
  type BehaviorCapabilityRegistry,
  type BehaviorProviderDefinition,
  type BehaviorStandardDispatcher,
} from '../../composition/behavior-capability-registry';

export type BehaviorCapabilityModuleInput = Readonly<{
  id: string;
  version: string;
  capabilities: readonly BehaviorProviderDefinition[];
  requires?: readonly CapabilityContract[];
  permissions?: readonly ModulePermission[];
}>;

const standard = (context: unknown): BehaviorStandardDispatcher => {
  const value = context as { __standard?: BehaviorStandardDispatcher };
  if (!value.__standard) throw new TypeError('The standard behavior provider is not bound to a Character runtime.');
  return value.__standard;
};
const standardSkill = (
  id: string,
  description: string,
  args: BehaviorProviderDefinition['arguments'],
): BehaviorProviderDefinition => ({
  id,
  version: '1.0.0',
  kind: 'skill',
  description,
  arguments: args,
  state: { version: '1.0.0', maximumBytes: 512 },
  start: (context, input) => standard(context).start(id, input, context),
  continue: (context, input, state) => standard(context).continue(id, input, state, context),
  cancel: (context, input, state, reason) => standard(context).cancel(id, input, state, reason, context),
});

const standardCapabilities: readonly BehaviorProviderDefinition[] = [
  {
    id: 'always',
    version: '1.0.0',
    kind: 'condition',
    description: 'Always true.',
    arguments: {},
    evaluate: () => true,
  },
  {
    id: 'hunger-at-least',
    version: '1.0.0',
    kind: 'condition',
    description: 'Hunger is at or above value.',
    arguments: { value: { type: 'number', required: true, minimum: 0, maximum: 100 } },
    evaluate: (context, args) => context.actorState.needs.hunger >= Number(args.value),
  },
  {
    id: 'hunger-at-most',
    version: '1.0.0',
    kind: 'condition',
    description: 'Hunger is at or below value.',
    arguments: { value: { type: 'number', required: true, minimum: 0, maximum: 100 } },
    evaluate: (context, args) => context.actorState.needs.hunger <= Number(args.value),
  },
  ...(
    [
      ['threat-visible', 'A current visible threat exists.', {}],
      ['dialogue-received', 'A new dialogue fact arrived since this consumer last evaluated.', {}],
      ['is-night', 'World time is outside 06:00-18:00.', {}],
      ['is-day', 'World time is within 06:00-18:00.', {}],
      [
        'at-position',
        'Actor is within radius of position.',
        {
          position: { type: 'position', required: true },
          radius: { type: 'number', minimum: 0.1, maximum: 16 },
        },
      ],
    ] as const
  ).map(([id, description, args]): BehaviorProviderDefinition => ({
    id,
    version: '1.0.0',
    kind: 'condition',
    description,
    arguments: args,
    evaluate: (context, input) => standard(context).evaluate(id, input),
  })),
  ...(
    [
      [
        'flee-threat',
        'Commit to a fixed retreat from the closest visible threat, then finish at that destination.',
        {
          distance: { type: 'number', minimum: 2, maximum: 24 },
          maxReplans: { type: 'number', minimum: 0, maximum: 64, integer: true },
        },
      ],
      ['attack-threat', 'Attack the closest visible threat.', {}],
      ['ignore-threat', 'Acknowledge the current threat.', {}],
      [
        'satisfy-hunger',
        'Collect and consume food through registered Inventory and Feeding operations until satisfied.',
        {
          satisfiedAt: { type: 'number', minimum: 0, maximum: 100 },
          avoidThreats: { type: 'boolean' },
          maxReplans: { type: 'number', minimum: 0, maximum: 64, integer: true },
        },
      ],
      [
        'rest-at-home',
        'Return home and rest until daylight.',
        { position: { type: 'position', required: true }, avoidThreats: { type: 'boolean' } },
      ],
      [
        'patrol',
        'Visit configured positions continuously.',
        {
          positions: { type: 'position', required: true },
          avoidThreats: { type: 'boolean' },
          maxReplans: { type: 'number', minimum: 0, maximum: 64, integer: true },
        },
      ],
      [
        'wander',
        'Visit deterministic nearby points continuously.',
        {
          radius: { type: 'number', minimum: 1, maximum: 16 },
          maxReplans: { type: 'number', minimum: 0, maximum: 64, integer: true },
        },
      ],
      [
        'move-to',
        'Walk to a fixed position.',
        {
          position: { type: 'position', required: true },
          maxReplans: { type: 'number', minimum: 0, maximum: 64, integer: true },
        },
      ],
      [
        'follow',
        'Follow a currently authorized entity target reference.',
        {
          targetRef: { type: 'entity-reference', required: true },
          maxReplans: { type: 'number', minimum: 0, maximum: 64, integer: true },
        },
      ],
      [
        'wait',
        'Wait for a bounded simulated duration.',
        { seconds: { type: 'number', required: true, minimum: 0, maximum: 3600 } },
      ],
      ['hold', 'Remain still until interrupted.', {}],
      [
        'speak',
        'Emit one bounded speech fact per activation.',
        { text: { type: 'string', required: true, maximum: 280 } },
      ],
    ] as const
  ).map(([id, description, args]): BehaviorProviderDefinition => standardSkill(id, description, args)),
];

/** Standard module owns the single aggregation facade; other modules extend it through composition requires. */
export function defineBehaviorRegistryModule(
  input: Readonly<{ permissions?: readonly ModulePermission[] }> = {},
): ModModule {
  return Object.freeze({
    descriptor: {
      id: STANDARD_BEHAVIOR_PROVIDER_MODULE_ID,
      version: '1.0.0',
      provides: [{ id: BEHAVIOR_REGISTRY_CAPABILITY, version: '1.0.0' }],
      ...(input.permissions ? { permissions: input.permissions } : {}),
    },
    register(api) {
      const registry = createBehaviorCapabilityRegistry();
      for (const capability of standardCapabilities) registry.register(api.identity, capability);
      api.provideCapability(BEHAVIOR_REGISTRY_CAPABILITY, registry);
      api.onDefinitionsReady(() => registry.freeze());
    },
  } satisfies ModModule);
}

/** Public Pack helper. Provider identity is derived from the assembly facade, never from model-authored data. */
export function defineBehaviorCapabilityModule(input: BehaviorCapabilityModuleInput): ModModule {
  return Object.freeze({
    descriptor: {
      id: input.id,
      version: input.version,
      requires: [{ id: BEHAVIOR_REGISTRY_CAPABILITY, version: '1.0.0' }, ...(input.requires ?? [])],
      ...(input.permissions ? { permissions: input.permissions } : {}),
    },
    register(api) {
      const registry = api.requireCapability<BehaviorCapabilityRegistry>(BEHAVIOR_REGISTRY_CAPABILITY);
      for (const capability of input.capabilities) registry.register(api.identity, capability);
    },
  } satisfies ModModule);
}
