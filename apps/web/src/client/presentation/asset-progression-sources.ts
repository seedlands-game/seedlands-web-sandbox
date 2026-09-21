import { pixelItemAssets } from './pixel-item-art';

export const progressionItemAssets = [
  ...pixelItemAssets('gold-pickaxe', '金镐', 'pickaxe', 'gold'),
  ...pixelItemAssets('diamond-pickaxe', '钻石镐', 'pickaxe', 'diamond'),
  ...pixelItemAssets('gold-ingot', '金锭', 'gold-ingot'),
  ...pixelItemAssets('diamond', '钻石', 'diamond'),
  ...pixelItemAssets('stick', '木棍', 'stick'),
  ...pixelItemAssets('wood-pickaxe', '木镐', 'pickaxe'),
  ...pixelItemAssets('iron-pickaxe', '铁镐', 'pickaxe', 'iron'),
  ...pixelItemAssets('coal', '煤', 'coal'),
  ...pixelItemAssets('charcoal', '木炭', 'coal'),
  ...pixelItemAssets('raw-iron', '铁矿石', 'raw-iron'),
  ...pixelItemAssets('iron-ingot', '铁锭', 'iron-ingot'),
];
