import { progressionItemAssets } from './asset-progression-sources';
import { legacyPixelAssets } from './legacy-item-assets';
import type { Asset, ItemAssetBinding } from './asset-types';
import { nativeToolAssets } from './asset-tool-sources';
import { builtinVisualAssets } from './visual-asset-catalog';
import { requireClassicItemDefinition } from './classic-item-registry';

const nativeItemAssets = [...nativeToolAssets, ...progressionItemAssets];

// Explicit first-party bindings. Coverage against the authoritative item registry is tested.
const items = [
  ['dirt-block', '泥土块'],
  ['stone-block', '石块'],
  ['wood-block', '原木'],
  ['sand-block', '沙块'],
  ['berry', '浆果'],
  ['plank', '木板'],
  ['cobblestone', '圆石'],
  ['glass', '玻璃'],
  ['charcoal', '木炭'],
  ['gold-ore', '金矿石'],
  ['diamond-ore', '钻石矿石'],
  ['iron-block', '铁块'],
  ['gold-block', '金块'],
  ['diamond-block', '钻石块'],
  ['gold-ingot', '金锭'],
  ['diamond', '钻石'],
  ['sandstone', '砂岩'],
  ['stone-bricks', '石砖'],
  ['gold-pickaxe', '金镐'],
  ['diamond-pickaxe', '钻石镐'],
  ['stone-axe', '石斧'],
  ['iron-axe', '铁斧'],
  ['gold-axe', '金斧'],
  ['diamond-axe', '钻石斧'],
  ['stone-sword', '石剑'],
  ['iron-sword', '铁剑'],
  ['gold-sword', '金剑'],
  ['diamond-sword', '钻石剑'],
  ['wood-shovel', '木锹'],
  ['stone-shovel', '石锹'],
  ['iron-shovel', '铁锹'],
  ['gold-shovel', '金锹'],
  ['diamond-shovel', '钻石锹'],
  ['stick', '木棍'],
  ['wood-axe', '木斧'],
  ['wood-sword', '木剑'],
  ['stone-pickaxe', '石镐'],
  ['glowstone-block', '辉光石'],
  ['lantern', '灯笼'],
  ['workbench', '工作台'],
  ['chest', '箱子'],
  ['furnace', '炉体'],
  ['coal', '煤'],
  ['raw-iron', '铁矿石'],
  ['iron-ingot', '铁锭'],
  ['wood-pickaxe', '木镐'],
  ['iron-pickaxe', '铁镐'],
] as const;
const imageNames = [
  'dirt-block',
  'stone-block',
  'wood-block',
  'sand-block',
  'berry',
  'plank',
  'lantern',
  'workbench',
  'chest',
  'furnace',
] as const;

const itemMaterials: Record<string, string[]> = {
  'dirt-block': ['dirt'],
  'stone-block': ['stone'],
  'wood-block': ['wood', 'wood-end'],
  'sand-block': ['sand'],
  berry: ['berry', 'leaf'],
  plank: ['wood'],
  'glowstone-block': ['glow'],
  lantern: ['glow', 'brass'],
};
export const builtinAssets: Asset[] = [
  ...nativeItemAssets,
  ...legacyPixelAssets,
  ...builtinVisualAssets,
  ...imageNames.map((id): Asset => ({
    id: `builtin:image:${id}`,
    name: `${items.find(([key]) => key === id)![1]}图标`,
    source: 'builtin',
    revision: 1,
    type: 'image-texture',
    payload: { path: `assets/item-thumbnails/${id}.png` },
  })),
  ...items
    .filter(([id]) => !nativeItemAssets.some((asset) => asset.id === `builtin:model:${id}`))
    .map(([id, name]): Asset => ({
      id: `builtin:model:${id}`,
      name,
      source: 'builtin',
      revision: 1,
      type: 'builtin-item-model',
      payload: {
        itemId: id,
        materialIds: (() => {
          const voxel = requireClassicItemDefinition(id).placesVoxel;
          const placed = builtinVisualAssets.find(
            (asset) => asset.type === 'builtin-voxel-model' && asset.payload.voxelId === voxel,
          );
          return placed?.type === 'builtin-voxel-model'
            ? placed.payload.materialIds
            : itemMaterials[id].map((key) => `seedlands:material/model/${key}`);
        })(),
      },
    })),
];
export const builtinItemBindings: ItemAssetBinding[] = items.map(([itemId, name]) => {
  const modelId = `builtin:model:${itemId}`;
  const model = nativeItemAssets.find((asset) => asset.id === modelId);
  return {
    itemId,
    name,
    modelId,
    iconId:
      model?.type === 'extruded-pixel-model'
        ? model.payload.textureId
        : [
              'cobblestone',
              'glass',
              'gold-ore',
              'diamond-ore',
              'iron-block',
              'gold-block',
              'diamond-block',
              'sandstone',
              'stone-bricks',
            ].includes(itemId)
          ? 'seedlands:texture/terrain/' + itemId
          : `builtin:image:${itemId === 'glowstone-block' ? 'lantern' : itemId}`,
  };
});
export const builtinBinding = (itemId: string) => builtinItemBindings.find((b) => b.itemId === itemId);
