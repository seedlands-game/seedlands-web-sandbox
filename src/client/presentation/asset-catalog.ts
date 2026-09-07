import type { Asset, ItemAssetBinding } from './asset-types';
import { nativeToolAssets } from './asset-tool-sources';

// Explicit first-party bindings. Coverage against the authoritative item registry is tested.
const items = [
  ['dirt-block', '泥土块'],
  ['stone-block', '石块'],
  ['wood-block', '原木'],
  ['sand-block', '沙块'],
  ['berry', '浆果'],
  ['plank', '木板'],
  ['wood-axe', '木斧'],
  ['stone-pickaxe', '石镐'],
  ['glowstone-block', '辉光石'],
  ['lantern', '灯笼'],
] as const;
const imageNames = ['dirt-block', 'stone-block', 'wood-block', 'sand-block', 'berry', 'plank', 'lantern'] as const;
export const builtinAssets: Asset[] = [
  ...nativeToolAssets,
  ...imageNames.map((id): Asset => ({
    id: `builtin:image:${id}`,
    name: `${items.find(([key]) => key === id)![1]}图标`,
    source: 'builtin',
    revision: 1,
    type: 'image-texture',
    payload: { path: `assets/items/${id}.png` },
  })),
  ...items
    .filter(([id]) => id !== 'wood-axe' && id !== 'stone-pickaxe')
    .map(([id, name]): Asset => ({
      id: `builtin:model:${id}`,
      name,
      source: 'builtin',
      revision: 1,
      type: 'builtin-item-model',
      payload: { itemId: id },
    })),
];
export const builtinItemBindings: ItemAssetBinding[] = items.map(([itemId, name]) => ({
  itemId,
  name,
  modelId: `builtin:model:${itemId}`,
  iconId:
    itemId === 'wood-axe' || itemId === 'stone-pickaxe'
      ? `builtin:texture:${itemId}`
      : `builtin:image:${itemId === 'glowstone-block' ? 'lantern' : itemId}`,
}));
export const builtinBinding = (itemId: string) => builtinItemBindings.find((b) => b.itemId === itemId);
