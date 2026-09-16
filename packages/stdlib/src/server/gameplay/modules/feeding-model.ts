import type { EntityLifetimeReference } from '../../simulation/action-identity';
import type { GameplayContent } from '../gameplay-content';
import type { ItemDefinitionRegistry, ItemStack } from '../item-registry';
import { validateInventoryWorldItemProjection, type InventoryWorldItemProjectionV1 } from './inventory-action-model';

export const FEEDING_CAPABILITY = 'seedlands:feeding';
export const FEEDING_ACTOR_COMPONENT = 'seedlands:feeding-actor';
export const FEEDING_ITEM_COMPONENT = 'seedlands:feeding-item';
export const FEEDING_ACTOR_RESOURCE = 'seedlands.feeding-actor';
export const FEEDING_ITEM_RESOURCE = 'seedlands.feeding-item';
export const FEEDING_CONSUME_WORLD_ITEM_OPERATION = 'seedlands:consume-world-item';

const MAX_IDENTITY_LENGTH = 256;
const MAX_NEEDS_VALUE = 1_000_000;
const MAX_WORLD_COORDINATE = 30_000_000;

export type FeedingPosition = readonly [number, number, number];
export type FeedingNeedsProjectionV1 = Readonly<{
  hunger: number;
  maxHunger: number;
  meaning: 'satiety' | 'deficit';
}>;
export type FeedingActorProjectionV1 = Readonly<{
  version: 1;
  reference: EntityLifetimeReference;
  position: FeedingPosition;
  lifecycle: 'alive' | 'dead';
  active: boolean;
  archetype: string | null;
  needs: FeedingNeedsProjectionV1;
}>;
export type FeedingItemProjectionV1 = InventoryWorldItemProjectionV1;
export type FeedingRawInputV1 = Readonly<{ existingActionId: string }>;
export type FeedingNormalizedRawInputV1 = Readonly<{ existingActionId: string | null }>;
export type FeedingEffectiveInputV1 = Readonly<{ existingActionId: string | null; hungerRestore: number }>;
export type FeedingCandidateResultV1 = Readonly<{ success: true; consumedEntityId: string; count: 1 }>;
export type FeedingCandidateV1 = Readonly<{
  version: 1;
  kind: 'consume-world-item';
  actorReference: EntityLifetimeReference;
  itemReference: EntityLifetimeReference;
  position: FeedingPosition;
  previousStack: Readonly<ItemStack>;
  nextStack: Readonly<ItemStack> | null;
  hungerBefore: number;
  hungerAfter: number;
  existingActionId: string | null;
  result: FeedingCandidateResultV1;
}>;
export type FeedingContent = Readonly<Pick<GameplayContent, 'items'>>;
export type FeedingCandidateRequest = Readonly<{ actor: unknown; item: unknown; input: unknown }>;
export type FeedingCapabilityV1 = Readonly<{
  actorComponentId: typeof FEEDING_ACTOR_COMPONENT;
  itemComponentId: typeof FEEDING_ITEM_COMPONENT;
  consumeWorldItemOperationId: typeof FEEDING_CONSUME_WORLD_ITEM_OPERATION;
}>;

export const feedingActorAddress = (entityId: string) => ({
  componentId: FEEDING_ACTOR_COMPONENT,
  target: { kind: 'entity' as const, entityId },
});

export const feedingItemAddress = (entityId: string) => ({
  componentId: FEEDING_ITEM_COMPONENT,
  target: { kind: 'entity' as const, entityId },
});

export const feedingCapability = (): FeedingCapabilityV1 =>
  Object.freeze({
    actorComponentId: FEEDING_ACTOR_COMPONENT,
    itemComponentId: FEEDING_ITEM_COMPONENT,
    consumeWorldItemOperationId: FEEDING_CONSUME_WORLD_ITEM_OPERATION,
  });

export function feedingData(raw: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
  )
    throw new TypeError(`${label} must be an object.`);
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  for (const key of Reflect.ownKeys(descriptors))
    if (
      typeof key !== 'string' ||
      !allowed.includes(key) ||
      !descriptors[key].enumerable ||
      !('value' in descriptors[key])
    )
      throw new TypeError(`${label} has invalid fields.`);
  if (Object.keys(descriptors).length !== allowed.length || allowed.some((key) => !descriptors[key]))
    throw new TypeError(`${label} has missing fields.`);
  return raw as Record<string, unknown>;
}

export const feedingIdentity = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_IDENTITY_LENGTH && value.trim() === value;

const safeInteger = (value: unknown, min: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min;

const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function validateFeedingPosition(raw: unknown, label = 'Feeding position'): FeedingPosition {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length !== 3)
    throw new TypeError(`${label} is invalid.`);
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  for (const index of ['0', '1', '2']) {
    const descriptor = descriptors[index];
    if (
      !descriptor?.enumerable ||
      !('value' in descriptor) ||
      !finite(descriptor.value, -MAX_WORLD_COORDINATE, MAX_WORLD_COORDINATE)
    )
      throw new TypeError(`${label} is invalid.`);
  }
  if (Reflect.ownKeys(descriptors).some((key) => !['0', '1', '2', 'length'].includes(String(key))))
    throw new TypeError(`${label} has invalid fields.`);
  return Object.freeze([
    descriptors['0'].value as number,
    descriptors['1'].value as number,
    descriptors['2'].value as number,
  ]);
}

export function validateFeedingReference(raw: unknown, label: string): EntityLifetimeReference {
  const value = feedingData(raw, ['entityId', 'epoch', 'lifetime'], `${label} reference`);
  if (!feedingIdentity(value.entityId) || !safeInteger(value.epoch, 1) || !safeInteger(value.lifetime, 1))
    throw new TypeError(`${label} reference is invalid.`);
  return Object.freeze({ entityId: value.entityId, epoch: value.epoch, lifetime: value.lifetime });
}

export function validateFeedingActorProjection(raw: unknown): FeedingActorProjectionV1 {
  const value = feedingData(
    raw,
    ['version', 'reference', 'position', 'lifecycle', 'active', 'archetype', 'needs'],
    'Feeding actor projection',
  );
  if (
    value.version !== 1 ||
    !['alive', 'dead'].includes(String(value.lifecycle)) ||
    typeof value.active !== 'boolean' ||
    (value.archetype !== null && !feedingIdentity(value.archetype))
  )
    throw new TypeError('Feeding actor projection is invalid.');
  const needs = feedingData(value.needs, ['hunger', 'maxHunger', 'meaning'], 'Feeding needs projection');
  if (
    !finite(needs.maxHunger, Number.EPSILON, MAX_NEEDS_VALUE) ||
    !finite(needs.hunger, 0, needs.maxHunger) ||
    !['satiety', 'deficit'].includes(String(needs.meaning))
  )
    throw new TypeError('Feeding needs projection is invalid.');
  return Object.freeze({
    version: 1,
    reference: validateFeedingReference(value.reference, 'Feeding actor'),
    position: validateFeedingPosition(value.position, 'Feeding actor position'),
    lifecycle: value.lifecycle as FeedingActorProjectionV1['lifecycle'],
    active: value.active,
    archetype: value.archetype as string | null,
    needs: Object.freeze({
      hunger: needs.hunger,
      maxHunger: needs.maxHunger,
      meaning: needs.meaning as FeedingNeedsProjectionV1['meaning'],
    }),
  });
}

export const validateFeedingItemProjection = (raw: unknown, items: ItemDefinitionRegistry): FeedingItemProjectionV1 =>
  validateInventoryWorldItemProjection(raw, items);

export function validateFeedingRawInput(raw: unknown): FeedingNormalizedRawInputV1 {
  if (raw === undefined) return Object.freeze({ existingActionId: null });
  const value = feedingData(raw, ['existingActionId'], 'Feeding input');
  if (!feedingIdentity(value.existingActionId)) throw new TypeError('Feeding Action identity is invalid.');
  return Object.freeze({ existingActionId: value.existingActionId });
}

export function validateFeedingEffectiveInput(raw: unknown): FeedingEffectiveInputV1 {
  const value = feedingData(raw, ['existingActionId', 'hungerRestore'], 'Feeding effective input');
  if (
    (value.existingActionId !== null && !feedingIdentity(value.existingActionId)) ||
    !finite(value.hungerRestore, 0, MAX_NEEDS_VALUE)
  )
    throw new TypeError('Feeding effective input is invalid.');
  return Object.freeze({
    existingActionId: value.existingActionId as string | null,
    hungerRestore: value.hungerRestore,
  });
}

export function cloneFeedingStack(items: ItemDefinitionRegistry, raw: unknown): Readonly<ItemStack> {
  const stack = items.normalizeStack(raw);
  return Object.freeze({
    itemId: stack.itemId,
    count: stack.count,
    ...(stack.instance ? { instance: Object.freeze({ durability: stack.instance.durability }) } : {}),
  });
}

function fail(reason: string): never {
  throw new Error(reason);
}

/** Pure detached result. The host recomputes it against current projections before preparing all owners. */
export function buildFeedingCandidate(content: FeedingContent, request: FeedingCandidateRequest): FeedingCandidateV1 {
  const actor = validateFeedingActorProjection(request.actor);
  const item = validateFeedingItemProjection(request.item, content.items);
  const input = validateFeedingEffectiveInput(request.input);
  if (actor.reference.entityId === item.reference.entityId) fail('invalid-item');
  if (actor.lifecycle !== 'alive') fail('actor-dead');
  if (!actor.active) fail('actor-inactive');
  if (!content.items.capability(item.stack.itemId, 'consume')) fail('item-not-food');
  const previousStack = cloneFeedingStack(content.items, item.stack);
  const nextStack =
    previousStack.count === 1
      ? null
      : cloneFeedingStack(content.items, { ...previousStack, count: previousStack.count - 1 });
  const hungerAfter =
    actor.needs.meaning === 'satiety'
      ? Math.min(actor.needs.maxHunger, actor.needs.hunger + input.hungerRestore)
      : Math.max(0, actor.needs.hunger - input.hungerRestore);
  return Object.freeze({
    version: 1,
    kind: 'consume-world-item',
    actorReference: actor.reference,
    itemReference: item.reference,
    position: Object.freeze([...item.position]) as FeedingPosition,
    previousStack,
    nextStack,
    hungerBefore: actor.needs.hunger,
    hungerAfter,
    existingActionId: input.existingActionId,
    result: Object.freeze({ success: true, consumedEntityId: item.reference.entityId, count: 1 }),
  });
}
