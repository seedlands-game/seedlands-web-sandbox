import type { WorldComposition } from '../../composition/contracts';
import type { ModModule } from '../../composition/contracts';
import {
  freezeDeathInventorySettlementPolicyV1,
  type DeathInventorySettlementPolicyV1,
} from '../death-inventory-settlement';

export const DEATH_INVENTORY_POLICY_CAPABILITY = 'seedlands:death-inventory-policy';

export type ActorDeathPolicyKindV1 = 'player' | 'creature' | 'npc';

export type DeathInventoryPolicyDefinitionV1 = Readonly<{
  version: 1;
  actors: Readonly<Record<ActorDeathPolicyKindV1, DeathInventorySettlementPolicyV1>>;
}>;

export type DeathInventoryPolicyCapabilityV1 = Readonly<{
  definition: DeathInventoryPolicyDefinitionV1;
  policyFor(kind: ActorDeathPolicyKindV1): DeathInventorySettlementPolicyV1;
}>;

const ACTOR_KINDS = ['player', 'creature', 'npc'] as const;
const NAMESPACE_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;

const strictRecord = (raw: unknown, keys: readonly string[], label: string): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`${label} is invalid.`);
  const prototype = Object.getPrototypeOf(raw);
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Reflect.ownKeys(descriptors).some(
      (key) =>
        typeof key !== 'string' ||
        !keys.includes(key) ||
        !('value' in descriptors[key]!) ||
        descriptors[key]!.get !== undefined ||
        descriptors[key]!.set !== undefined,
    ) ||
    Object.keys(descriptors).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(descriptors, key))
  )
    throw new TypeError(`${label} is invalid.`);
  return raw as Record<string, unknown>;
};

const freezeDefinition = (raw: unknown): DeathInventoryPolicyDefinitionV1 => {
  const definition = strictRecord(raw, ['version', 'actors'], 'Death inventory policy definition');
  if (definition.version !== 1) throw new TypeError('Death inventory policy definition version is invalid.');
  const actors = strictRecord(definition.actors, ACTOR_KINDS, 'Death inventory actor policies');
  return Object.freeze({
    version: 1,
    actors: Object.freeze({
      player: freezeDeathInventorySettlementPolicyV1(actors.player),
      creature: freezeDeathInventorySettlementPolicyV1(actors.creature),
      npc: freezeDeathInventorySettlementPolicyV1(actors.npc),
    }),
  });
};

const actorKind = (raw: unknown): ActorDeathPolicyKindV1 => {
  if (typeof raw !== 'string' || !(ACTOR_KINDS as readonly string[]).includes(raw))
    throw new TypeError('Death inventory actor policy kind is invalid.');
  return raw as ActorDeathPolicyKindV1;
};

export function defineDeathInventoryPolicyModuleV1(
  input: Readonly<{
    moduleId: string;
    definition: DeathInventoryPolicyDefinitionV1;
  }>,
): ModModule {
  const options = strictRecord(input, ['moduleId', 'definition'], 'Death inventory policy module input');
  if (typeof options.moduleId !== 'string' || !NAMESPACE_ID.test(options.moduleId))
    throw new TypeError('Death inventory policy module id is invalid.');
  const moduleId = options.moduleId;
  const definition = freezeDefinition(options.definition);
  const capability: DeathInventoryPolicyCapabilityV1 = Object.freeze({
    definition,
    policyFor: (kind) => definition.actors[actorKind(kind)],
  });
  return Object.freeze({
    descriptor: {
      id: moduleId,
      version: '1.0.0',
      provides: [
        {
          id: DEATH_INVENTORY_POLICY_CAPABILITY,
          version: '1.0.0',
          definitionIdentity: JSON.stringify(definition),
        },
      ],
    },
    register(api) {
      api.provideCapability(DEATH_INVENTORY_POLICY_CAPABILITY, capability);
    },
  } satisfies ModModule);
}

export function resolveDeathInventoryPolicyCapabilityV1(
  composition: Pick<WorldComposition, 'capability' | 'definitionMap'>,
): DeathInventoryPolicyCapabilityV1 | null {
  if (!composition.definitionMap.capabilities.some(({ id }) => id === DEATH_INVENTORY_POLICY_CAPABILITY)) return null;
  return composition.capability<DeathInventoryPolicyCapabilityV1>(DEATH_INVENTORY_POLICY_CAPABILITY);
}
