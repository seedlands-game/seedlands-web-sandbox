import type { EntityLifetimeReference } from '../../simulation/action-identity';
import { createInventoryCandidate } from './inventory-api';
import type { InventorySlot } from '../inventory';
import type { GameplayContent } from '../gameplay-content';
import type { ItemDefinitionRegistry, ItemStack } from '../item-registry';
import { applyCraftingMatch, shapelessCraftingProvider } from './crafting-provider';
import { validateInventoryCursor, type InventoryCursorV1 } from './inventory-pointer-contract';

export const INVENTORY_ACTIONS_CAPABILITY = 'seedlands:inventory-actions';
export const INVENTORY_ACTOR_COMPONENT = 'seedlands:inventory-actor';
export const INVENTORY_ITEM_COMPONENT = 'seedlands:inventory-item';
export const INVENTORY_RESOURCE = 'seedlands.inventory';
export const INVENTORY_ITEM_RESOURCE = 'seedlands.inventory-item';
export const INVENTORY_SELECT_OPERATION = 'seedlands:inventory-select';
export const INVENTORY_MOVE_OPERATION = 'seedlands:inventory-move';
export const INVENTORY_CONSUME_OPERATION = 'seedlands:inventory-consume';
export const INVENTORY_CRAFT_OPERATION = 'seedlands:inventory-craft';
export const INVENTORY_DROP_OPERATION = 'seedlands:inventory-drop';
export const INVENTORY_PICKUP_OPERATION = 'seedlands:inventory-pickup';

const MAX_IDENTITY_LENGTH = 256;
const MAX_ACTION_COUNT = 1_000_000;
const MAX_INVENTORY_CAPACITY = 64;
const MAX_NEEDS_VALUE = 1_000_000;
const MAX_WORLD_COORDINATE = 30_000_000;

export type InventoryEquipmentProjection = Readonly<{ selectedSlot: number; hotbarSize: number }>;
export type InventoryNeedsProjection = Readonly<{
  hunger: number;
  maxHunger: number;
  meaning: 'satiety' | 'deficit';
}>;
export type InventoryActorProjectionV1 = Readonly<{
  version: 1;
  reference: EntityLifetimeReference;
  kind: 'player' | 'creature' | 'npc';
  slots: readonly InventorySlot[];
  equipment: InventoryEquipmentProjection;
  lifecycle: 'alive' | 'dead';
  needs: InventoryNeedsProjection;
  inventoryRevision: number;
  cursor: InventoryCursorV1;
}>;
export type InventoryWorldItemProjectionV1 = Readonly<{
  version: 1;
  reference: EntityLifetimeReference;
  position: readonly [number, number, number];
  stack: Readonly<ItemStack>;
}>;

export type InventoryActionKind = 'select' | 'move' | 'consume' | 'craft' | 'drop' | 'pickup';
export type InventorySelectArgs = Readonly<{ slot: number }>;
export type InventoryMoveArgs = Readonly<{ source: number; target: number }>;
export type InventoryConsumeArgs = Readonly<{ slot: number }>;
export type InventoryCraftArgs = Readonly<{ recipeId: string }>;
export type InventoryDropArgs = Readonly<{ slot: number; count: number }>;
export type InventoryPickupArgs = Readonly<Record<never, never>>;
export type InventoryActionArgs =
  | InventorySelectArgs
  | InventoryMoveArgs
  | InventoryConsumeArgs
  | InventoryCraftArgs
  | InventoryDropArgs
  | InventoryPickupArgs;

export type InventoryDropIntentV1 = Readonly<{ stack: Readonly<ItemStack> }>;
export type InventoryPickupIntentV1 = Readonly<{
  reference: EntityLifetimeReference;
  position: readonly [number, number, number];
  stack: Readonly<ItemStack>;
}>;
export type InventoryActionPublicResultV1 = Readonly<{
  version: 1;
  success: true;
  kind: InventoryActionKind;
  actorId: string;
  itemId?: string;
  count?: number;
  recipeId?: string;
  selectedSlot: number;
  hunger: number;
}>;

type InventoryActionCandidateBase<Kind extends InventoryActionKind, Args extends InventoryActionArgs> = Readonly<{
  version: 1;
  kind: Kind;
  actorId: string;
  actorReference: EntityLifetimeReference;
  args: Args;
  slots: readonly InventorySlot[];
  equipment: InventoryEquipmentProjection;
  hunger: InventoryNeedsProjection;
  dropIntent: InventoryDropIntentV1 | null;
  pickupIntent: InventoryPickupIntentV1 | null;
  result: InventoryActionPublicResultV1;
}>;

export type InventorySelectCandidateV1 = InventoryActionCandidateBase<'select', InventorySelectArgs>;
export type InventoryMoveCandidateV1 = InventoryActionCandidateBase<'move', InventoryMoveArgs>;
export type InventoryConsumeCandidateV1 = InventoryActionCandidateBase<'consume', InventoryConsumeArgs>;
export type InventoryCraftCandidateV1 = InventoryActionCandidateBase<'craft', InventoryCraftArgs>;
export type InventoryDropCandidateV1 = InventoryActionCandidateBase<'drop', InventoryDropArgs>;
export type InventoryPickupCandidateV1 = InventoryActionCandidateBase<'pickup', InventoryPickupArgs>;
export type InventoryActionCandidateV1 =
  | InventorySelectCandidateV1
  | InventoryMoveCandidateV1
  | InventoryConsumeCandidateV1
  | InventoryCraftCandidateV1
  | InventoryDropCandidateV1
  | InventoryPickupCandidateV1;

export type InventoryActionsCapabilityV1 = Readonly<{
  actorComponentId: typeof INVENTORY_ACTOR_COMPONENT;
  itemComponentId: typeof INVENTORY_ITEM_COMPONENT;
  selectOperationId: typeof INVENTORY_SELECT_OPERATION;
  moveOperationId: typeof INVENTORY_MOVE_OPERATION;
  consumeOperationId: typeof INVENTORY_CONSUME_OPERATION;
  craftOperationId: typeof INVENTORY_CRAFT_OPERATION;
  dropOperationId: typeof INVENTORY_DROP_OPERATION;
  pickupOperationId: typeof INVENTORY_PICKUP_OPERATION;
}>;

export type InventoryActionContent = Readonly<Pick<GameplayContent, 'items' | 'recipes' | 'crafting'>>;
export type InventoryActionCandidateRequest =
  | Readonly<{ kind: 'select'; actor: unknown; input: unknown }>
  | Readonly<{ kind: 'move'; actor: unknown; input: unknown }>
  | Readonly<{ kind: 'consume'; actor: unknown; input: unknown }>
  | Readonly<{ kind: 'craft'; actor: unknown; input: unknown }>
  | Readonly<{ kind: 'drop'; actor: unknown; input: unknown }>
  | Readonly<{ kind: 'pickup'; actor: unknown; item: unknown; input: unknown }>;

export const inventoryActorAddress = (entityId: string) => ({
  componentId: INVENTORY_ACTOR_COMPONENT,
  target: { kind: 'entity' as const, entityId },
});
export const inventoryItemAddress = (entityId: string) => ({
  componentId: INVENTORY_ITEM_COMPONENT,
  target: { kind: 'entity' as const, entityId },
});

export const inventoryActionsCapability = (): InventoryActionsCapabilityV1 =>
  Object.freeze({
    actorComponentId: INVENTORY_ACTOR_COMPONENT,
    itemComponentId: INVENTORY_ITEM_COMPONENT,
    selectOperationId: INVENTORY_SELECT_OPERATION,
    moveOperationId: INVENTORY_MOVE_OPERATION,
    consumeOperationId: INVENTORY_CONSUME_OPERATION,
    craftOperationId: INVENTORY_CRAFT_OPERATION,
    dropOperationId: INVENTORY_DROP_OPERATION,
    pickupOperationId: INVENTORY_PICKUP_OPERATION,
  });

const identity = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_IDENTITY_LENGTH && value.trim() === value;
const safeInteger = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

function actionData(raw: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
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

function validateReference(raw: unknown, label: string): EntityLifetimeReference {
  const value = actionData(raw, ['entityId', 'epoch', 'lifetime'], `${label} reference`);
  if (
    !identity(value.entityId) ||
    !safeInteger(value.epoch, 1, Number.MAX_SAFE_INTEGER) ||
    !safeInteger(value.lifetime, 1, Number.MAX_SAFE_INTEGER)
  )
    throw new TypeError(`${label} reference is invalid.`);
  return Object.freeze({ entityId: value.entityId, epoch: value.epoch, lifetime: value.lifetime });
}

function freezeStack(stack: ItemStack): Readonly<ItemStack> {
  return Object.freeze({
    itemId: stack.itemId,
    count: stack.count,
    ...(stack.instance ? { instance: Object.freeze({ durability: stack.instance.durability }) } : {}),
  });
}

function validateStack(
  items: ItemDefinitionRegistry,
  raw: unknown,
  label: string,
  maximumCount: number,
): Readonly<ItemStack> {
  const hasInstance = Boolean(raw) && typeof raw === 'object' && Object.hasOwn(raw as object, 'instance');
  const value = actionData(raw, hasInstance ? ['itemId', 'count', 'instance'] : ['itemId', 'count'], label);
  if (hasInstance) actionData(value.instance, ['durability'], `${label} instance`);
  const stack = items.normalizeStack(raw);
  if (stack.count > maximumCount) throw new TypeError(`${label} count is too large.`);
  return freezeStack(stack);
}

function freezeSlots(slots: readonly InventorySlot[]): readonly InventorySlot[] {
  return Object.freeze(slots.map((slot) => (slot ? freezeStack(slot) : null)));
}

export function validateInventoryActorProjection(
  raw: unknown,
  items: ItemDefinitionRegistry,
): InventoryActorProjectionV1 {
  const value = actionData(
    raw,
    ['version', 'reference', 'kind', 'slots', 'equipment', 'lifecycle', 'needs', 'inventoryRevision', 'cursor'],
    'Inventory actor projection',
  );
  const reference = validateReference(value.reference, 'Inventory actor');
  if (
    value.version !== 1 ||
    !['player', 'creature', 'npc'].includes(String(value.kind)) ||
    !Array.isArray(value.slots) ||
    value.slots.length < 1 ||
    value.slots.length > MAX_INVENTORY_CAPACITY ||
    !['alive', 'dead'].includes(String(value.lifecycle))
  )
    throw new TypeError('Inventory actor projection is invalid.');
  const slots = freezeSlots(
    value.slots.map((slot, index) => {
      if (slot === null) return null;
      const stack = validateStack(items, slot, `Inventory slot ${index}`, MAX_ACTION_COUNT);
      if (stack.count > items.require(stack.itemId).stackLimit)
        throw new TypeError(`Inventory slot ${index} exceeds its stack limit.`);
      return stack;
    }),
  );
  const equipment = actionData(value.equipment, ['selectedSlot', 'hotbarSize'], 'Inventory equipment projection');
  if (
    !safeInteger(equipment.hotbarSize, 1, slots.length) ||
    !safeInteger(equipment.selectedSlot, 0, equipment.hotbarSize - 1)
  )
    throw new TypeError('Inventory equipment projection is invalid.');
  const needs = actionData(value.needs, ['hunger', 'maxHunger', 'meaning'], 'Inventory needs projection');
  if (
    !finite(needs.maxHunger, Number.EPSILON, MAX_NEEDS_VALUE) ||
    !finite(needs.hunger, 0, needs.maxHunger) ||
    !['satiety', 'deficit'].includes(String(needs.meaning))
  )
    throw new TypeError('Inventory needs projection is invalid.');
  const inventoryRevision = value.inventoryRevision === undefined ? 0 : value.inventoryRevision;
  if (!safeInteger(inventoryRevision, 0, Number.MAX_SAFE_INTEGER))
    throw new TypeError('Inventory actor revision is invalid.');
  const cursor = validateInventoryCursor(value.cursor, items);
  return Object.freeze({
    version: 1,
    reference,
    kind: value.kind as InventoryActorProjectionV1['kind'],
    slots,
    equipment: Object.freeze({ selectedSlot: equipment.selectedSlot, hotbarSize: equipment.hotbarSize }),
    lifecycle: value.lifecycle as InventoryActorProjectionV1['lifecycle'],
    needs: Object.freeze({
      hunger: needs.hunger,
      maxHunger: needs.maxHunger,
      meaning: needs.meaning as InventoryNeedsProjection['meaning'],
    }),
    inventoryRevision,
    cursor,
  });
}

export function validateInventoryWorldItemProjection(
  raw: unknown,
  items: ItemDefinitionRegistry,
): InventoryWorldItemProjectionV1 {
  const value = actionData(raw, ['version', 'reference', 'position', 'stack'], 'Inventory item projection');
  const reference = validateReference(value.reference, 'Inventory item');
  if (value.version !== 1 || !Array.isArray(value.position) || value.position.length !== 3)
    throw new TypeError('Inventory item projection is invalid.');
  const position = value.position.map((coordinate) => {
    if (!finite(coordinate, -MAX_WORLD_COORDINATE, MAX_WORLD_COORDINATE))
      throw new TypeError('Inventory item position is invalid.');
    return coordinate;
  }) as [number, number, number];
  const stack = validateStack(items, value.stack, 'Inventory item stack', MAX_ACTION_COUNT);
  return Object.freeze({ version: 1, reference, position: Object.freeze(position), stack });
}

export function validateInventorySelectInput(raw: unknown): InventorySelectArgs {
  const value = actionData(raw, ['slot'], 'Inventory select input');
  if (!safeInteger(value.slot, 0, MAX_INVENTORY_CAPACITY - 1)) throw new TypeError('Inventory slot is invalid.');
  return Object.freeze({ slot: value.slot });
}
export function validateInventoryMoveInput(raw: unknown): InventoryMoveArgs {
  const value = actionData(raw, ['source', 'target'], 'Inventory move input');
  if (
    !safeInteger(value.source, 0, MAX_INVENTORY_CAPACITY - 1) ||
    !safeInteger(value.target, 0, MAX_INVENTORY_CAPACITY - 1) ||
    value.source === value.target
  )
    throw new TypeError('Inventory move slots are invalid.');
  return Object.freeze({ source: value.source, target: value.target });
}
export function validateInventoryConsumeInput(raw: unknown): InventoryConsumeArgs {
  const value = actionData(raw, ['slot'], 'Inventory consume input');
  if (!safeInteger(value.slot, 0, MAX_INVENTORY_CAPACITY - 1)) throw new TypeError('Inventory slot is invalid.');
  return Object.freeze({ slot: value.slot });
}
export function validateInventoryCraftInput(raw: unknown): InventoryCraftArgs {
  const value = actionData(raw, ['recipeId'], 'Inventory craft input');
  if (!identity(value.recipeId)) throw new TypeError('Inventory recipe identity is invalid.');
  return Object.freeze({ recipeId: value.recipeId });
}
export function validateInventoryDropInput(raw: unknown): InventoryDropArgs {
  const value = actionData(raw, ['slot', 'count'], 'Inventory drop input');
  if (!safeInteger(value.slot, 0, MAX_INVENTORY_CAPACITY - 1) || !safeInteger(value.count, 1, MAX_ACTION_COUNT))
    throw new TypeError('Inventory drop input is invalid.');
  return Object.freeze({ slot: value.slot, count: value.count });
}
export function validateInventoryPickupInput(raw: unknown): InventoryPickupArgs {
  if (raw !== undefined) throw new TypeError('Inventory pickup input must be omitted.');
  return Object.freeze({});
}

function fail(reason: string): never {
  throw new Error(reason);
}

function assertContent(content: InventoryActionContent): void {
  if (content.recipes.items !== content.items)
    throw new TypeError('Inventory action item and recipe registries do not match.');
}

function candidate<Kind extends InventoryActionKind, Args extends InventoryActionArgs>(input: {
  kind: Kind;
  actor: InventoryActorProjectionV1;
  args: Args;
  inventory: ReturnType<typeof createInventoryCandidate>;
  hunger?: number;
  dropIntent?: InventoryDropIntentV1;
  pickupIntent?: InventoryPickupIntentV1;
  result?: Partial<Pick<InventoryActionPublicResultV1, 'itemId' | 'count' | 'recipeId'>>;
}): InventoryActionCandidateBase<Kind, Args> {
  const hunger = Object.freeze({
    ...input.actor.needs,
    ...(input.hunger === undefined ? {} : { hunger: input.hunger }),
  });
  const result = Object.freeze({
    version: 1 as const,
    success: true as const,
    kind: input.kind,
    actorId: input.actor.reference.entityId,
    ...input.result,
    selectedSlot:
      input.kind === 'select' ? (input.args as InventorySelectArgs).slot : input.actor.equipment.selectedSlot,
    hunger: hunger.hunger,
  });
  return Object.freeze({
    version: 1 as const,
    kind: input.kind,
    actorId: input.actor.reference.entityId,
    actorReference: input.actor.reference,
    args: input.args,
    slots: freezeSlots(input.inventory.snapshot()),
    equipment: Object.freeze({
      selectedSlot: result.selectedSlot,
      hotbarSize: input.actor.equipment.hotbarSize,
    }),
    hunger,
    dropIntent: input.dropIntent ?? null,
    pickupIntent: input.pickupIntent ?? null,
    result,
  });
}

/** Pure, detached operation builder. Host owners may recompute it against current projections before prepare. */
export function buildInventoryActionCandidate(
  content: InventoryActionContent,
  request: InventoryActionCandidateRequest,
): InventoryActionCandidateV1 {
  assertContent(content);
  const actor = validateInventoryActorProjection(request.actor, content.items);
  if (actor.lifecycle !== 'alive') fail('actor-dead');
  const inventory = createInventoryCandidate(content.items, actor.slots);
  switch (request.kind) {
    case 'select': {
      const args = validateInventorySelectInput(request.input);
      if (args.slot >= actor.equipment.hotbarSize) fail('invalid-slot');
      return candidate({ kind: request.kind, actor, args, inventory });
    }
    case 'move': {
      const args = validateInventoryMoveInput(request.input);
      if (!inventory.moveStack(args.source, args.target)) fail('cannot-move-item');
      return candidate({ kind: request.kind, actor, args, inventory });
    }
    case 'consume': {
      const args = validateInventoryConsumeInput(request.input);
      const selected = inventory.slot(args.slot);
      if (!selected) fail('no-selected-item');
      const consume = content.items.capability(selected.itemId, 'consume');
      if (!consume) fail('item-not-usable');
      if (actor.needs.meaning === 'satiety' ? actor.needs.hunger >= actor.needs.maxHunger : actor.needs.hunger <= 0)
        fail('hunger-full');
      if (!inventory.removeFromSlot(args.slot, 1)) fail('missing-items');
      const hunger =
        actor.needs.meaning === 'satiety'
          ? Math.min(actor.needs.maxHunger, actor.needs.hunger + consume.hungerRestore)
          : Math.max(0, actor.needs.hunger - consume.hungerRestore);
      return candidate({
        kind: request.kind,
        actor,
        args,
        inventory,
        hunger,
        result: { itemId: selected.itemId, count: 1 },
      });
    }
    case 'craft': {
      const args = validateInventoryCraftInput(request.input);
      const crafted = applyCraftingMatch(
        inventory,
        args.recipeId,
        content.recipes,
        content.crafting === undefined ? shapelessCraftingProvider : content.crafting,
        actor.equipment.selectedSlot,
      );
      if (!crafted.success) fail(crafted.reason);
      return candidate({ kind: request.kind, actor, args, inventory, result: { recipeId: args.recipeId } });
    }
    case 'drop': {
      const args = validateInventoryDropInput(request.input);
      const selected = inventory.slot(args.slot);
      if (!selected || selected.count < args.count) fail('missing-items');
      if (!inventory.removeFromSlot(args.slot, args.count)) fail('missing-items');
      const stack = freezeStack({ ...selected, count: args.count });
      return candidate({
        kind: request.kind,
        actor,
        args,
        inventory,
        dropIntent: Object.freeze({ stack }),
        result: { itemId: stack.itemId, count: stack.count },
      });
    }
    case 'pickup': {
      const args = validateInventoryPickupInput(request.input);
      const item = validateInventoryWorldItemProjection(request.item, content.items);
      if (item.reference.entityId === actor.reference.entityId) fail('invalid-item');
      if (!inventory.add(item.stack)) fail('inventory-full');
      const pickupIntent = Object.freeze({
        reference: item.reference,
        position: item.position,
        stack: item.stack,
      });
      return candidate({
        kind: request.kind,
        actor,
        args,
        inventory,
        pickupIntent,
        result: { itemId: item.stack.itemId, count: item.stack.count },
      });
    }
  }
}
