import { GAMEPLAY_CONTENT_CAPABILITIES, gameplayContentFromRegistration } from './content-capabilities';
import type { ActorModuleExecutionContext } from '../../composition/authorized-execution';
import type { ModModule, ModuleInvocationValue } from '../../composition/contracts';
import type { ModCandidateState } from '../../composition/operation-contracts';
import type { ItemDefinitionRegistry } from '../item-registry';
import {
  FEEDING_ACTOR_RESOURCE,
  FEEDING_CAPABILITY,
  FEEDING_CONSUME_WORLD_ITEM_OPERATION,
  FEEDING_ITEM_RESOURCE,
  buildFeedingCandidate,
  feedingActorAddress,
  feedingData,
  feedingIdentity,
  feedingItemAddress,
  validateFeedingActorProjection,
  validateFeedingEffectiveInput,
  validateFeedingItemProjection,
  validateFeedingRawInput,
  type FeedingActorProjectionV1,
  type FeedingEffectiveInputV1,
  type FeedingItemProjectionV1,
} from './feeding-model';

const MAX_ARCHETYPES = 128;
const MAX_NEEDS_VALUE = 1_000_000;

export type FeedingRulesModuleOptions = Readonly<{
  moduleId: string;
  eligibleArchetypes: readonly string[];
  deficitThreshold: number;
  restore: 'full' | 'food';
}>;
type FeedingPolicy = FeedingRulesModuleOptions;

function stringArray(raw: unknown): readonly string[] {
  if (
    !Array.isArray(raw) ||
    Object.getPrototypeOf(raw) !== Array.prototype ||
    raw.length < 1 ||
    raw.length > MAX_ARCHETYPES
  )
    throw new TypeError('Feeding eligible archetypes are invalid.');
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(descriptors).some((key) => !/^\d+$/.test(String(key)) && key !== 'length'))
    throw new TypeError('Feeding eligible archetypes have invalid fields.');
  const values = Array.from({ length: raw.length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !('value' in descriptor) || !feedingIdentity(descriptor.value))
      throw new TypeError('Feeding eligible archetype is invalid.');
    return descriptor.value;
  });
  if (new Set(values).size !== values.length) throw new TypeError('Feeding eligible archetypes are duplicated.');
  return Object.freeze(values);
}

function validatePolicy(raw: unknown): FeedingPolicy {
  const value = feedingData(
    raw,
    ['moduleId', 'eligibleArchetypes', 'deficitThreshold', 'restore'],
    'Feeding Rules options',
  );
  if (
    !feedingIdentity(value.moduleId) ||
    typeof value.deficitThreshold !== 'number' ||
    !Number.isFinite(value.deficitThreshold) ||
    value.deficitThreshold < 0 ||
    value.deficitThreshold > MAX_NEEDS_VALUE ||
    (value.restore !== 'full' && value.restore !== 'food')
  )
    throw new TypeError('Feeding Rules options are invalid.');
  return Object.freeze({
    moduleId: value.moduleId,
    eligibleArchetypes: stringArray(value.eligibleArchetypes),
    deficitThreshold: value.deficitThreshold,
    restore: value.restore,
  });
}

function actorId(context: ActorModuleExecutionContext): string {
  if (context.kind !== 'actor' || !context.originalActorId) throw new TypeError('Feeding rule requires an actor.');
  return context.originalActorId;
}

function itemId(context: ActorModuleExecutionContext): string {
  if (context.target.kind !== 'entity' || !feedingIdentity(context.target.entityId))
    throw new TypeError('Feeding rule requires an item entity target.');
  return context.target.entityId;
}

function deficit(actor: FeedingActorProjectionV1): number {
  return actor.needs.meaning === 'deficit' ? actor.needs.hunger : actor.needs.maxHunger - actor.needs.hunger;
}

function current(
  context: ActorModuleExecutionContext,
  state: ModCandidateState,
  items: ItemDefinitionRegistry,
): Readonly<{ actor: FeedingActorProjectionV1; item: FeedingItemProjectionV1 }> {
  const boundActorId = actorId(context);
  const targetItemId = itemId(context);
  const actor = validateFeedingActorProjection(state.read(feedingActorAddress(boundActorId)));
  const item = validateFeedingItemProjection(state.read(feedingItemAddress(targetItemId)), items);
  if (actor.reference.entityId !== boundActorId)
    throw new TypeError('Feeding rule actor projection does not match the bound actor.');
  if (item.reference.entityId !== targetItemId)
    throw new TypeError('Feeding rule item projection does not match the target item.');
  return Object.freeze({ actor, item });
}

function derive(
  policy: FeedingPolicy,
  actor: FeedingActorProjectionV1,
  item: FeedingItemProjectionV1,
  items: ItemDefinitionRegistry,
  existingActionId: string | null,
): FeedingEffectiveInputV1 {
  if (actor.lifecycle !== 'alive') throw new Error('actor-dead');
  if (!actor.active) throw new Error('actor-inactive');
  if (actor.archetype === null || !policy.eligibleArchetypes.includes(actor.archetype))
    throw new Error('actor-ineligible');
  const missing = deficit(actor);
  if (missing < policy.deficitThreshold) throw new Error('not-hungry');
  const food = items.capability(item.stack.itemId, 'consume');
  if (!food) throw new Error('invalid-food');
  return Object.freeze({
    existingActionId,
    hungerRestore: policy.restore === 'full' ? missing : food.hungerRestore,
  });
}

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

export function defineFeedingRulesModule(options: FeedingRulesModuleOptions): ModModule {
  const policy = validatePolicy(options);
  return Object.freeze({
    descriptor: {
      id: policy.moduleId,
      version: '1.0.0',
      requires: [
        { id: FEEDING_CAPABILITY, version: '1.0.0' },
        ...GAMEPLAY_CONTENT_CAPABILITIES.map((id) => ({ id, version: '1.0.0' })),
      ],
      permissions: [
        { resource: FEEDING_ACTOR_RESOURCE, operations: ['read', 'execute'] },
        { resource: FEEDING_ITEM_RESOURCE, operations: ['read', 'execute'] },
      ],
    },
    register(api) {
      api.requireCapability(FEEDING_CAPABILITY);
      const itemCapability = api.requireCapability<ItemDefinitionRegistry>('seedlands:items');
      const contentCapabilities = gameplayContentFromRegistration(api);
      const content = () => {
        const resolved = contentCapabilities;
        for (const item of resolved.items.list())
          if (!itemCapability.has(item.id)) throw new TypeError(`Feeding Rules item capability is missing ${item.id}.`);
        return resolved;
      };
      api.registerRule({
        id: `${policy.moduleId}/before`,
        operationId: FEEDING_CONSUME_WORLD_ITEM_OPERATION,
        stage: 'before',
        apply(context, input, state) {
          if (context.kind !== 'actor') throw new TypeError('Feeding rule requires actor execution.');
          const raw = validateFeedingRawInput(input);
          const resolved = content();
          const projections = current(context, state, resolved.items);
          return { input: derive(policy, projections.actor, projections.item, resolved.items, raw.existingActionId) };
        },
      });
      api.registerRule({
        id: `${policy.moduleId}/after`,
        operationId: FEEDING_CONSUME_WORLD_ITEM_OPERATION,
        stage: 'after',
        apply(context, input, state, candidate) {
          if (context.kind !== 'actor') return { reject: 'feeding-candidate-context-mismatch' };
          const effective = validateFeedingEffectiveInput(input);
          const resolved = content();
          const projections = current(context, state, resolved.items);
          const expectedInput = derive(
            policy,
            projections.actor,
            projections.item,
            resolved.items,
            effective.existingActionId,
          );
          if (!same(effective, expectedInput)) return { reject: 'feeding-policy-mismatch' };
          const expected = buildFeedingCandidate(resolved, {
            actor: projections.actor,
            item: projections.item,
            input: expectedInput,
          });
          if (!same(candidate as ModuleInvocationValue, expected)) return { reject: 'feeding-candidate-mismatch' };
        },
      });
    },
  } satisfies ModModule);
}
