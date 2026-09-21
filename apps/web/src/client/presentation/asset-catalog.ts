import { progressionItemAssets } from './asset-progression-sources';
import { legacyPixelAssets } from './legacy-item-assets';
import type { Asset, ItemAssetBinding } from './asset-types';
import { nativeToolAssets } from './asset-tool-sources';
import { builtinVisualAssets } from './visual-asset-catalog';
import { requireClassicItemDefinition } from './classic-item-registry';
import { dyeItemNames } from './dye-item-assets';

const nativeItemAssets = [...nativeToolAssets, ...progressionItemAssets];

// Explicit first-party bindings. Coverage against the authoritative item registry is tested.
const items = [
  ...dyeItemNames,
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
  ['apple', '苹果'],
  ['bread', '面包'],
  ['raw-porkchop', '生猪排'],
  ['cooked-porkchop', '熟猪排'],
  ['raw-fish', '生鱼'],
  ['cooked-fish', '熟鱼'],
  ['wheat', '小麦'],
  ['wheat-seeds', '小麦种子'],
  ['leather', '皮革'],
  ['bowl', '碗'],
  ['bucket', '桶'],
  ['water-bucket', '水桶'],
  ['shears', '剪刀'],
  ['minecart', '矿车'],
  ['chest-minecart', '运输矿车'],
  ['furnace-minecart', '动力矿车'],
  ['boat', '船'],
  ['bow', '弓'],
  ['arrow', '箭'],
  ['string', '线'],
  ['feather', '羽毛'],
  ['flint', '燧石'],
  ['wool', '羊毛'],
  ['ink-sac', '墨囊'],
  ['rotten-flesh', '腐肉'],
  ['bone', '骨头'],
  ['gunpowder', '火药'],
  ['slimeball', '黏液球'],
  ['bed', '床'],
  ['saddle', '鞍'],
  ['lava-bucket', '熔岩桶'],
  ['obsidian', '黑曜石'],
  ['tnt', 'TNT'],
  ['sapling', '树苗'],
  ['flower', '花'],
  ['mushroom', '蘑菇'],
  ['sugar-cane', '甘蔗'],
  ['cactus', '仙人掌'],
  ['leather-helmet', '皮革头盔'],
  ['leather-chestplate', '皮革胸甲'],
  ['leather-leggings', '皮革护腿'],
  ['leather-boots', '皮革靴子'],
  ['iron-helmet', '铁头盔'],
  ['iron-chestplate', '铁胸甲'],
  ['iron-leggings', '铁护腿'],
  ['iron-boots', '铁靴子'],
  ['gold-helmet', '金头盔'],
  ['gold-chestplate', '金胸甲'],
  ['gold-leggings', '金护腿'],
  ['gold-boots', '金靴子'],
  ['diamond-helmet', '钻石头盔'],
  ['diamond-chestplate', '钻石胸甲'],
  ['diamond-leggings', '钻石护腿'],
  ['diamond-boots', '钻石靴子'],
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
  ['wood-hoe', '木锄'],
  ['stone-hoe', '石锄'],
  ['iron-hoe', '铁锄'],
  ['gold-hoe', '金锄'],
  ['diamond-hoe', '钻石锄'],
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
        : itemId === 'raw-iron'
          ? 'seedlands:texture/terrain/iron-ore'
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
                'obsidian',
                'tnt',
                'sapling',
                'flower',
                'mushroom',
                'sugar-cane',
                'cactus',
              ].includes(itemId)
            ? 'seedlands:texture/terrain/' + itemId
            : `builtin:image:${itemId === 'glowstone-block' ? 'lantern' : itemId}`,
  };
});
export const builtinBinding = (itemId: string) => builtinItemBindings.find((b) => b.itemId === itemId);
