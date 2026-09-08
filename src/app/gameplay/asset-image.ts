import type { PixelTexture } from '../../client/presentation/asset-types';
import { builtinAssets, builtinBinding, builtinItemBindings } from '../../client/presentation/asset-catalog';
import { publicAssetUrl, setPublicAssetOverrides } from '../../client/presentation/public-asset-url';
import type { AppearanceProject } from '../../client/presentation/appearance-project';

export function pixelCanvas(asset: PixelTexture): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const { width, height, palette, pixels } = asset.payload;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法创建像素画布');
  const data = context.createImageData(width, height);
  pixels.forEach((index, i) => {
    if (index === 0) return;
    data.data.set([...palette[index], 255], i * 4);
  });
  context.putImageData(data, 0, 0);
  return canvas;
}
export const pixelImageUrl = (asset: PixelTexture) => pixelCanvas(asset).toDataURL('image/png');
let thumbnails: Record<string, string> = {};
export function setAppearanceImages(project: AppearanceProject) {
  thumbnails = { ...project.thumbnails };
  const overrides: Record<string, string> = {};
  for (const asset of project.assets) {
    const builtin = builtinAssets.find((candidate) => candidate.id === asset.id);
    if (asset.type === 'image-texture' && builtin?.type === 'image-texture') {
      overrides[builtin.payload.path] = asset.payload.path;
      for (const binding of builtinItemBindings) {
        if (binding.iconId === asset.id && asset.id === `builtin:image:${binding.itemId}`)
          thumbnails[binding.modelId] = asset.payload.path;
      }
    }
  }
  setPublicAssetOverrides(overrides);
}
export function itemIconUrl(itemId: string, base: string): string {
  const binding = builtinBinding(itemId);
  if (binding && thumbnails[binding.modelId]) return thumbnails[binding.modelId];
  if (binding) return publicAssetUrl(base, `assets/item-thumbnails/${itemId}.png`);
  return '';
}
