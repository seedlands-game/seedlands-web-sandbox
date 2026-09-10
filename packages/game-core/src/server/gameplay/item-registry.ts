import { overworldItems } from './playbooks/overworld/items';
import { Voxel } from '../../world/voxel';
import {
  normalizeItemStack,
  type ItemDurabilityDefinition,
  type ItemInstanceState,
  type ItemStackNormalizationOptions,
} from './item-instance';

export const ItemIds = Object.freeze({
  DirtBlock: 'dirt-block',
  StoneBlock: 'stone-block',
  WoodBlock: 'wood-block',
  SandBlock: 'sand-block',
  Berry: 'berry',
  Plank: 'plank',
  Workbench: 'workbench',
  Chest: 'chest',
  Furnace: 'furnace',
  Coal: 'coal',
  RawIron: 'raw-iron',
  IronIngot: 'iron-ingot',
  WoodPickaxe: 'wood-pickaxe',
  IronPickaxe: 'iron-pickaxe',
  WoodAxe: 'wood-axe',
  StonePickaxe: 'stone-pickaxe',
  GlowstoneBlock: 'glowstone-block',
  Lantern: 'lantern',
  WoodSword: 'wood-sword',
} as const);

export type ItemId = string;
export type ItemStack = { itemId: ItemId; count: number; instance?: ItemInstanceState };
export type PlaceItemCapability = Readonly<{ type: 'place'; voxel: number }>;
export type ConsumeItemCapability = Readonly<{ type: 'consume'; hungerRestore: number }>;
export type MineItemCapability = Readonly<{
  type: 'mine';
  tool: 'axe' | 'pickaxe';
  multiplier: number;
  /** Omitted legacy tiers are interpreted as tier zero by mining policy. */
  tier?: number;
}>;
export type MeleeItemCapability = Readonly<{ type: 'melee'; definitionId: string }>;
export type ItemCapability = PlaceItemCapability | ConsumeItemCapability | MineItemCapability | MeleeItemCapability;
export type ItemCapabilityType = ItemCapability['type'];
export type ItemCapabilityOf<Type extends ItemCapabilityType> = Extract<ItemCapability, { type: Type }>;

export type ItemDefinition = Readonly<{
  id: ItemId;
  name: string;
  itemType: 'block' | 'resource' | 'food' | 'tool';
  stackLimit: number;
  durability?: ItemDurabilityDefinition;
  capabilities: readonly ItemCapability[];
  /** Compatibility projections for existing presentation consumers. */
  placesVoxel?: number;
  toolKind?: 'axe' | 'pickaxe';
  hungerRestore?: number;
}>;

export type ItemDefinitionInput = Omit<
  ItemDefinition,
  'capabilities' | 'placesVoxel' | 'toolKind' | 'hungerRestore'
> & {
  capabilities: readonly ItemCapability[];
};

export type ItemDefinitionRegistry = Readonly<{
  get: (id: string) => ItemDefinition | undefined;
  require: (id: string) => ItemDefinition;
  has: (id: string) => boolean;
  list: () => readonly ItemDefinition[];
  capability: <Type extends ItemCapabilityType>(id: string, type: Type) => ItemCapabilityOf<Type> | undefined;
  normalizeStack: (value: unknown, options?: ItemStackNormalizationOptions) => ItemStack;
  assertStack: (stack: { itemId: string; count: number }) => asserts stack is ItemStack;
}>;

const ITEM_IDENTITY = /^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._/-]*)?$/;

export const isItemId = (value: unknown): value is ItemId => typeof value === 'string' && ITEM_IDENTITY.test(value);

const defineItem = (input: ItemDefinitionInput): ItemDefinition => {
  if (!isItemId(input.id) || !input.name.trim()) throw new TypeError(`Item identity is invalid: ${String(input.id)}`);
  if (!['block', 'resource', 'food', 'tool'].includes(input.itemType))
    throw new TypeError(`Item type is invalid: ${input.id}`);
  if (!Number.isSafeInteger(input.stackLimit) || input.stackLimit <= 0)
    throw new TypeError(`Item stack limit is invalid: ${input.id}`);
  if (input.durability !== undefined) {
    if (
      typeof input.durability !== 'object' ||
      input.durability === null ||
      Array.isArray(input.durability) ||
      Object.keys(input.durability).length !== 1 ||
      !Object.hasOwn(input.durability, 'max') ||
      input.itemType !== 'tool' ||
      input.stackLimit !== 1 ||
      !Number.isSafeInteger(input.durability.max) ||
      input.durability.max <= 0
    )
      throw new TypeError(`Item durability definition is invalid: ${input.id}`);
  }
  const seen = new Set<ItemCapabilityType>();
  const capabilities = input.capabilities.map((source) => {
    if (!['place', 'consume', 'mine', 'melee'].includes(source.type))
      throw new TypeError(`Item capability is invalid: ${input.id}`);
    if (seen.has(source.type)) throw new TypeError(`Duplicate ${source.type} capability: ${input.id}`);
    seen.add(source.type);
    if (source.type === 'place' && (!Number.isSafeInteger(source.voxel) || source.voxel <= Voxel.Air))
      throw new TypeError(`Place capability is invalid: ${input.id}`);
    if (source.type === 'consume' && (!Number.isFinite(source.hungerRestore) || source.hungerRestore <= 0))
      throw new TypeError(`Consume capability is invalid: ${input.id}`);
    if (source.type === 'mine' && source.tool !== 'axe' && source.tool !== 'pickaxe')
      throw new TypeError(`Mine capability is invalid: ${input.id}`);
    if (
      source.type === 'mine' &&
      (!Number.isFinite(source.multiplier) ||
        source.multiplier <= 1 ||
        (source.tier !== undefined && (!Number.isSafeInteger(source.tier) || source.tier < 0)))
    )
      throw new TypeError(`Mine capability is invalid: ${input.id}`);
    if (source.type === 'melee' && !source.definitionId.trim())
      throw new TypeError(`Melee capability is invalid: ${input.id}`);
    return Object.freeze({ ...source });
  });
  const place = capabilities.find((value): value is PlaceItemCapability => value.type === 'place');
  const consume = capabilities.find((value): value is ConsumeItemCapability => value.type === 'consume');
  const mine = capabilities.find((value): value is MineItemCapability => value.type === 'mine');
  return Object.freeze({
    ...input,
    ...(input.durability ? { durability: Object.freeze({ max: input.durability.max }) } : {}),
    capabilities: Object.freeze(capabilities),
    ...(place ? { placesVoxel: place.voxel } : {}),
    ...(consume ? { hungerRestore: consume.hungerRestore } : {}),
    ...(mine ? { toolKind: mine.tool } : {}),
  });
};

export function createItemDefinitionRegistry(
  inputs: readonly ItemDefinitionInput[],
  meleeDefinitionExists?: (id: string) => boolean,
): ItemDefinitionRegistry {
  const registered = new Map<string, ItemDefinition>();
  for (const input of inputs) {
    if (registered.has(input.id)) throw new TypeError(`Duplicate item definition: ${input.id}`);
    const definition = defineItem(input);
    const melee = definition.capabilities.find(
      (capability): capability is MeleeItemCapability => capability.type === 'melee',
    );
    if (melee && (!meleeDefinitionExists || !meleeDefinitionExists(melee.definitionId)))
      throw new TypeError(`Item ${input.id} references unknown melee definition: ${melee.definitionId}`);
    registered.set(input.id, definition);
  }
  const values = Object.freeze([...registered.values()]);
  const require = (id: string) => {
    const definition = registered.get(id);
    if (!definition) throw new RangeError(`Unknown item: ${String(id)}`);
    return definition;
  };
  const capability = <Type extends ItemCapabilityType>(id: string, type: Type) =>
    require(id).capabilities.find((candidate): candidate is ItemCapabilityOf<Type> => candidate.type === type);
  const registry: ItemDefinitionRegistry = Object.freeze({
    get: (id: string) => registered.get(id),
    require,
    has: (id: string) => registered.has(id),
    list: () => values,
    capability,
    normalizeStack: (value: unknown, options?: ItemStackNormalizationOptions) =>
      normalizeItemStack(registry, value, options),
    assertStack: (stack: { itemId: string; count: number }): asserts stack is ItemStack => {
      normalizeItemStack(registry, stack);
    },
  });
  return registry;
}

export const defaultItemDefinitionRegistry = createItemDefinitionRegistry(overworldItems, (id) => id === 'wood-sword');

export function getItemDefinition(itemId: ItemId | string): ItemDefinition {
  return defaultItemDefinitionRegistry.require(itemId);
}

export function getItemCapability<Type extends ItemCapabilityType>(
  itemId: ItemId | string,
  type: Type,
): ItemCapabilityOf<Type> | undefined {
  return defaultItemDefinitionRegistry.capability(itemId, type);
}

export const listItemDefinitions = (): readonly ItemDefinition[] => defaultItemDefinitionRegistry.list();

export const assertItemStack = (stack: { itemId: string; count: number }): asserts stack is ItemStack =>
  defaultItemDefinitionRegistry.assertStack(stack);
