import type { ActorBehavior } from '../simulation/actor-state';
import type { ActorArchetype, EntityType } from './entity-store';
import type { ItemDefinitionRegistry, ItemStack } from './item-registry';
import type { MeleeDefinition } from './melee-definition-registry';

export type AutonomousActorEntityType = Extract<EntityType, 'creature' | 'npc'>;
export type ActorNavigationProfile = Readonly<{ speed: number; perceptionRange: number }>;
export type ActorProfileInput = Readonly<{
  archetype: ActorArchetype;
  entityType: AutonomousActorEntityType;
  maxHealth: number;
  navigation: ActorNavigationProfile;
  initialBehavior?: ActorBehavior;
  meleeDefinitionId?: string;
  deathDrop?: ItemStack;
}>;
export type ActorProfile = ActorProfileInput;

export type StarterEcologyActorSlot = 'forager' | 'predator' | 'resident';
export type StarterEcologyActorInput = Readonly<{
  slot: StarterEcologyActorSlot;
  idPrefix: string;
  archetype: ActorArchetype;
  hunger?: number;
}>;
export type StarterEcologyConfigurationInput = Readonly<{
  version: 1;
  actors: readonly StarterEcologyActorInput[];
  initialItem: ItemStack;
}>;
export type StarterEcologyConfiguration = StarterEcologyConfigurationInput;

export type ActorProfileRegistry = Readonly<{
  get(archetype: ActorArchetype): ActorProfile | undefined;
  require(archetype: ActorArchetype): ActorProfile;
  list(): readonly ActorProfile[];
  defaultPlayerMeleeDefinitionId: string | null;
  starterEcology: StarterEcologyConfiguration | null;
}>;

const ARCHETYPES: readonly ActorArchetype[] = ['grazer', 'night-stalker', 'settler'];
const BEHAVIORS: readonly ActorBehavior[] = [
  'idle',
  'wander',
  'seek-food',
  'flee',
  'chase',
  'attack',
  'routine-home',
  'routine-work',
];

const finitePositive = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be positive.`);
  return value;
};
const freezeStack = (items: ItemDefinitionRegistry, value: ItemStack): ItemStack => {
  const stack = items.normalizeStack(value);
  return Object.freeze({
    ...stack,
    ...(stack.instance ? { instance: Object.freeze({ ...stack.instance }) } : {}),
  });
};

export function createActorProfileRegistry(
  inputs: readonly ActorProfileInput[],
  items: ItemDefinitionRegistry,
  meleeDefinitions: readonly MeleeDefinition[],
  defaultPlayerMeleeDefinitionId?: string,
  starterEcology?: StarterEcologyConfigurationInput,
): ActorProfileRegistry {
  const melee = new Set(meleeDefinitions.map(({ id }) => id));
  const profiles = new Map<ActorArchetype, ActorProfile>();
  for (const input of inputs) {
    if (!ARCHETYPES.includes(input.archetype) || profiles.has(input.archetype))
      throw new TypeError(`Duplicate or invalid actor profile: ${String(input.archetype)}`);
    if (input.entityType !== 'creature' && input.entityType !== 'npc')
      throw new TypeError(`Actor profile entity type is invalid: ${input.archetype}`);
    if (!Number.isSafeInteger(input.maxHealth) || input.maxHealth <= 0)
      throw new TypeError(`Actor profile max health is invalid: ${input.archetype}`);
    if (input.initialBehavior !== undefined && !BEHAVIORS.includes(input.initialBehavior))
      throw new TypeError(`Actor profile behavior is invalid: ${input.archetype}`);
    if (input.meleeDefinitionId !== undefined && !melee.has(input.meleeDefinitionId))
      throw new TypeError(`Actor profile references unknown melee definition: ${input.meleeDefinitionId}`);
    const deathDrop = input.deathDrop ? freezeStack(items, input.deathDrop) : undefined;
    profiles.set(
      input.archetype,
      Object.freeze({
        archetype: input.archetype,
        entityType: input.entityType,
        maxHealth: input.maxHealth,
        navigation: Object.freeze({
          speed: finitePositive(input.navigation.speed, `${input.archetype} speed`),
          perceptionRange: finitePositive(input.navigation.perceptionRange, `${input.archetype} perception range`),
        }),
        ...(input.initialBehavior !== undefined ? { initialBehavior: input.initialBehavior } : {}),
        ...(input.meleeDefinitionId !== undefined ? { meleeDefinitionId: input.meleeDefinitionId } : {}),
        ...(deathDrop ? { deathDrop } : {}),
      }),
    );
  }
  if (defaultPlayerMeleeDefinitionId !== undefined && !melee.has(defaultPlayerMeleeDefinitionId))
    throw new TypeError(`Default player melee references unknown definition: ${defaultPlayerMeleeDefinitionId}`);
  let ecology: StarterEcologyConfiguration | null = null;
  if (starterEcology !== undefined) {
    if (starterEcology.version !== 1) throw new TypeError('Starter ecology version is invalid.');
    const slots = new Set<StarterEcologyActorSlot>();
    const actors = starterEcology.actors.map((actor) => {
      if (!['forager', 'predator', 'resident'].includes(actor.slot) || slots.has(actor.slot))
        throw new TypeError(`Duplicate or invalid starter ecology slot: ${String(actor.slot)}`);
      slots.add(actor.slot);
      if (!actor.idPrefix.trim() || !profiles.has(actor.archetype))
        throw new TypeError(`Starter ecology actor is invalid: ${actor.idPrefix}`);
      if (actor.hunger !== undefined && (!Number.isFinite(actor.hunger) || actor.hunger < 0 || actor.hunger > 100))
        throw new TypeError(`Starter ecology hunger is invalid: ${actor.idPrefix}`);
      return Object.freeze({ ...actor });
    });
    if (slots.size !== 3) throw new TypeError('Starter ecology requires one actor in each bounded layout slot.');
    ecology = Object.freeze({
      version: 1,
      actors: Object.freeze(actors),
      initialItem: freezeStack(items, starterEcology.initialItem),
    });
  }
  const values = Object.freeze([...profiles.values()]);
  const require = (archetype: ActorArchetype) => {
    const profile = profiles.get(archetype);
    if (!profile) throw new RangeError(`Unknown actor profile: ${archetype}`);
    return profile;
  };
  return Object.freeze({
    get: (archetype: ActorArchetype) => profiles.get(archetype),
    require,
    list: () => values,
    defaultPlayerMeleeDefinitionId: defaultPlayerMeleeDefinitionId ?? null,
    starterEcology: ecology,
  });
}

/** Explicit compatibility content for uncomposed callers; unsupported references are omitted. */
export function createLegacyActorProfileRegistry(
  items: ItemDefinitionRegistry,
  meleeDefinitions: readonly MeleeDefinition[],
): ActorProfileRegistry {
  return createActorProfileRegistry([], items, meleeDefinitions);
}
