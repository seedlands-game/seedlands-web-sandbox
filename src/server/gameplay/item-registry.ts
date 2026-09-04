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
  Lantern: 'lantern',
} as const);

export type ItemId = (typeof ItemIds)[keyof typeof ItemIds];
export type ItemStack = { itemId: ItemId; count: number };
export type ItemDefinition = Readonly<{
  id: ItemId;
  name: string;
  itemType: 'block' | 'resource' | 'food' | 'tool';
  stackLimit: number;
  placesVoxel?: number;
  toolKind?: 'axe' | 'pickaxe';
  hungerRestore?: number;
}>;

const definitions: Readonly<Record<ItemId, ItemDefinition>> = Object.freeze({
  [ItemIds.Lantern]: {
    id: ItemIds.Lantern,
    name: '灯笼',
    itemType: 'block',
    stackLimit: 64,
    placesVoxel: Voxel.Lantern,
  },
  [ItemIds.DirtBlock]: {
    id: ItemIds.DirtBlock,
    name: '泥土块',
    itemType: 'block',
    stackLimit: 64,
    placesVoxel: Voxel.Dirt,
  },
  [ItemIds.StoneBlock]: {
    id: ItemIds.StoneBlock,
    name: '石块',
    itemType: 'block',
    stackLimit: 64,
    placesVoxel: Voxel.Stone,
  },
  [ItemIds.WoodBlock]: {
    id: ItemIds.WoodBlock,
    name: '原木',
    itemType: 'block',
    stackLimit: 64,
    placesVoxel: Voxel.Wood,
  },
  [ItemIds.SandBlock]: {
    id: ItemIds.SandBlock,
    name: '沙块',
    itemType: 'block',
    stackLimit: 64,
    placesVoxel: Voxel.Sand,
  },
  [ItemIds.Berry]: {
    id: ItemIds.Berry,
    name: '浆果',
    itemType: 'food',
    stackLimit: 64,
    hungerRestore: 4,
  },
  [ItemIds.Plank]: { id: ItemIds.Plank, name: '木板', itemType: 'resource', stackLimit: 64 },
  [ItemIds.WoodAxe]: {
    id: ItemIds.WoodAxe,
    name: '木斧',
    itemType: 'tool',
    stackLimit: 1,
    toolKind: 'axe',
  },
  [ItemIds.StonePickaxe]: {
    id: ItemIds.StonePickaxe,
    name: '石镐',
    itemType: 'tool',
    stackLimit: 1,
    toolKind: 'pickaxe',
  },
});

export const isItemId = (value: unknown): value is ItemId =>
  typeof value === 'string' && Object.hasOwn(definitions, value);

export function getItemDefinition(itemId: ItemId | string): ItemDefinition {
  if (!isItemId(itemId)) throw new RangeError(`Unknown item: ${String(itemId)}`);
  return definitions[itemId];
}

export const listItemDefinitions = (): readonly ItemDefinition[] => Object.values(definitions);

export function assertItemStack(stack: { itemId: string; count: number }): asserts stack is ItemStack {
  getItemDefinition(stack.itemId);
  if (!Number.isInteger(stack.count) || stack.count <= 0)
    throw new TypeError('Item stack count must be a positive integer.');
}
