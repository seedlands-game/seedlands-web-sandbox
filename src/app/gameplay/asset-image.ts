import type { PixelTexture } from '../../client/presentation/asset-types';
import { builtinAssets, builtinBinding } from '../../client/presentation/asset-catalog';
import { publicAssetUrl } from '../../client/presentation/public-asset-url';

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
const icons = new Map<string, string>();
export function itemIconUrl(itemId: string, base: string): string {
  const binding = builtinBinding(itemId);
  const asset = builtinAssets.find((a) => a.id === binding?.iconId);
  if (asset?.type === 'pixel-texture') {
    if (!icons.has(asset.id)) icons.set(asset.id, pixelImageUrl(asset));
    return icons.get(asset.id)!;
  }
  if (asset?.type === 'image-texture') return publicAssetUrl(base, asset.payload.path);
  return '';
}
