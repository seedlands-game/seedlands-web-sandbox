import type { Asset, NativeAsset } from './asset-types';

const adapters = {
  'pixel-texture': { label: '像素贴图', editable: true, preview: 'pixels', held: false },
  'extruded-pixel-model': { label: '像素挤出模型', editable: true, preview: 'model', held: true },
  'image-texture': { label: '图片贴图', editable: false, preview: 'image', held: false },
  'builtin-item-model': { label: '内置程序化模型', editable: false, preview: 'model', held: false },
} as const;
export const assetAdapter = (type: Asset['type']) => adapters[type];
export const isNativeAsset = (asset: Asset): asset is NativeAsset =>
  asset.type === 'pixel-texture' || asset.type === 'extruded-pixel-model';
export const assetDependencies = (asset: Asset): string[] =>
  asset.type === 'extruded-pixel-model' ? [asset.payload.textureId] : [];
export const acceptsPixelItem = (item: { id: string; itemType: string; placesVoxel?: number }) =>
  (item.id === 'wood-axe' || item.id === 'stone-pickaxe') &&
  item.itemType !== 'block' &&
  item.placesVoxel === undefined;
