import { Voxel } from '../../world/voxel';

export const ItemIds = Object.freeze({
  DirtBlock: 'dirt-block',
  StoneBlock: 'stone-block',
  WoodBlock: 'wood-block',
  SandBlock: 'sand-block',
  Berry: 'berry',
  Plank: 'plank',
  WoodAxe: 'wood-axe',
  StonePickaxe: 'stone-pickaxe',
  GlowstoneBlock: 'glowstone-block',
  Lantern: 'lantern',
  WoodSword: 'wood-sword',
} as const);

export type ItemId = (typeof ItemIds)[keyof typeof ItemIds];
export type ItemStack = { itemId: ItemId; count: number };
export type PlaceItemCapability = Readonly<{ type: 'place'; voxel: number }>;
export type ConsumeItemCapability = Readonly<{ type: 'consume'; hungerRestore: number }>;
export type MineItemCapability = Readonly<{ type: 'mine'; tool: 'axe' | 'pickaxe'; multiplier: number }>;
export type MeleeItemCapability = Readonly<{ type: 'melee'; definitionId: string }>;
export type ItemCapability = PlaceItemCapability | ConsumeItemCapability | MineItemCapability | MeleeItemCapability;
export type ItemCapabilityType = ItemCapability['type'];
export type ItemCapabilityOf<Type extends ItemCapabilityType> = Extract<ItemCapability, { type: Type }>;

export type ItemDefinition = Readonly<{
  id: ItemId;
  name: string;
  itemType: 'block' | 'resource' | 'food' | 'tool';
  stackLimit: number;
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
  list: () => readonly ItemDefinition[];
}>;

const defineItem = (input: ItemDefinitionInput): ItemDefinition => {
  if (!input.id.trim() || !input.name.trim()) throw new TypeError('Item identity must not be empty.');
  if (!['block', 'resource', 'food', 'tool'].includes(input.itemType))
    throw new TypeError(`Item type is invalid: ${input.id}`);
  if (!Number.isSafeInteger(input.stackLimit) || input.stackLimit <= 0)
    throw new TypeError(`Item stack limit is invalid: ${input.id}`);
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
    if (source.type === 'mine' && (!Number.isFinite(source.multiplier) || source.multiplier <= 1))
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
  return Object.freeze({ get: (id: string) => registered.get(id), list: () => values });
}

const definitions: Readonly<Record<ItemId, ItemDefinition>> = Object.freeze({
  [ItemIds.GlowstoneBlock]: defineItem({
    id: ItemIds.GlowstoneBlock,
    name: '辉光石',
    itemType: 'block',
    stackLimit: 64,
    capabilities: [{ type: 'place', voxel: Voxel.Glowstone }],
  }),
  [ItemIds.Lantern]: defineItem({
    id: ItemIds.Lantern,
    name: '灯笼',
    itemType: 'block',
    stackLimit: 64,
    capabilities: [{ type: 'place', voxel: Voxel.Lantern }],
  }),
  [ItemIds.DirtBlock]: defineItem({
    id: ItemIds.DirtBlock,
    name: '泥土块',
    itemType: 'block',
    stackLimit: 64,
    capabilities: [{ type: 'place', voxel: Voxel.Dirt }],
  }),
  [ItemIds.StoneBlock]: defineItem({
    id: ItemIds.StoneBlock,
    name: '石块',
    itemType: 'block',
    stackLimit: 64,
    capabilities: [{ type: 'place', voxel: Voxel.Stone }],
  }),
  [ItemIds.WoodBlock]: defineItem({
    id: ItemIds.WoodBlock,
    name: '原木',
    itemType: 'block',
    stackLimit: 64,
    capabilities: [{ type: 'place', voxel: Voxel.Wood }],
  }),
  [ItemIds.SandBlock]: defineItem({
    id: ItemIds.SandBlock,
    name: '沙块',
    itemType: 'block',
    stackLimit: 64,
    capabilities: [{ type: 'place', voxel: Voxel.Sand }],
  }),
  [ItemIds.Berry]: defineItem({
    id: ItemIds.Berry,
    name: '浆果',
    itemType: 'food',
    stackLimit: 64,
    capabilities: [{ type: 'consume', hungerRestore: 4 }],
  }),
  [ItemIds.Plank]: defineItem({
    id: ItemIds.Plank,
    name: '木板',
    itemType: 'resource',
    stackLimit: 64,
    capabilities: [],
  }),
  [ItemIds.WoodAxe]: defineItem({
    id: ItemIds.WoodAxe,
    name: '木斧',
    itemType: 'tool',
    stackLimit: 1,
    capabilities: [{ type: 'mine', tool: 'axe', multiplier: 3 }],
  }),
  [ItemIds.StonePickaxe]: defineItem({
    id: ItemIds.StonePickaxe,
    name: '石镐',
    itemType: 'tool',
    stackLimit: 1,
    capabilities: [{ type: 'mine', tool: 'pickaxe', multiplier: 4 }],
  }),
  [ItemIds.WoodSword]: defineItem({
    id: ItemIds.WoodSword,
    name: '木剑',
    itemType: 'tool',
    stackLimit: 1,
    capabilities: [{ type: 'melee', definitionId: 'wood-sword' }],
  }),
});

export const isItemId = (value: unknown): value is ItemId =>
  typeof value === 'string' && Object.hasOwn(definitions, value);

export function getItemDefinition(itemId: ItemId | string): ItemDefinition {
  if (!isItemId(itemId)) throw new RangeError(`Unknown item: ${String(itemId)}`);
  return definitions[itemId];
}

export function getItemCapability<Type extends ItemCapabilityType>(
  itemId: ItemId | string,
  type: Type,
): ItemCapabilityOf<Type> | undefined {
  return getItemDefinition(itemId).capabilities.find(
    (capability): capability is ItemCapabilityOf<Type> => capability.type === type,
  );
}

export const listItemDefinitions = (): readonly ItemDefinition[] => Object.freeze(Object.values(definitions));

export function assertItemStack(stack: { itemId: string; count: number }): asserts stack is ItemStack {
  getItemDefinition(stack.itemId);
  if (!Number.isInteger(stack.count) || stack.count <= 0)
    throw new TypeError('Item stack count must be a positive integer.');
}
