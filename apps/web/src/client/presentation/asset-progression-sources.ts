import { pixelItemAssets } from './pixel-item-art';

export const progressionItemAssets = [
  ...pixelItemAssets('stick', '木棍', 'stick'),
  ...pixelItemAssets('wood-pickaxe', '木镐', 'pickaxe'),
  ...pixelItemAssets('iron-pickaxe', '铁镐', 'pickaxe', 'iron'),
  ...pixelItemAssets('coal', '煤', 'coal'),
  ...pixelItemAssets('charcoal', '木炭', 'coal'),
  ...pixelItemAssets('raw-iron', '铁矿石', 'raw-iron'),
  ...pixelItemAssets('iron-ingot', '铁锭', 'iron-ingot'),
];
