import { pixelItemAssets } from './pixel-item-art';

export const progressionItemAssets = [
  ...pixelItemAssets('wood-pickaxe', '木镐', 'pickaxe'),
  ...pixelItemAssets('iron-pickaxe', '铁镐', 'pickaxe', 'iron'),
  ...pixelItemAssets('coal', '煤', 'coal'),
  ...pixelItemAssets('raw-iron', '粗铁', 'raw-iron'),
  ...pixelItemAssets('iron-ingot', '铁锭', 'iron-ingot'),
];
