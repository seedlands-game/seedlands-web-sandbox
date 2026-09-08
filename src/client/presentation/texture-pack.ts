import type { PixelTexture } from './asset-types';
import { validateNativeAssets } from './asset-package';
import { terrainMaterial } from './terrain-assets';

export type AtlasEntry = { id: string; revision: number; x: number; y: number; width: number; height: number };
export type TextureAtlas = {
  compilerVersion: 1;
  width: number;
  height: number;
  padding: 1;
  entries: AtlasEntry[];
  pixels: Uint8ClampedArray;
};
export function validateTerrainTexture(value: unknown, face: number): PixelTexture {
  const material = terrainMaterial(face);
  if (!material) throw new Error('未知的逻辑材质');
  const [texture] = validateNativeAssets([value], true);
  if (texture.type !== 'pixel-texture' || texture.payload.width !== 16 || texture.payload.height !== 16)
    throw new Error('pixel16 地形贴图必须为 16×16，不会自动缩放');
  if (material.renderMode === 'opaque' && texture.payload.pixels.includes(0))
    throw new Error('不透明材质不能包含透明像素');
  return texture;
}
export function textureRgba(texture: PixelTexture): Uint8ClampedArray {
  const { palette, pixels } = texture.payload;
  const output = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((index, i) => {
    if (index !== 0) output.set([...palette[index], 255], i * 4);
  });
  return output;
}
export function compileTextureAtlas(input: PixelTexture[]): TextureAtlas {
  if (!input.length || input.length > 256) throw new Error('图集需要 1–256 张贴图');
  if (new Set(input.map((texture) => texture.id)).size !== input.length) throw new Error('资产标识重复');
  const textures = input
    .map((texture) => validateNativeAssets([texture], true)[0])
    .map((asset) => {
      if (asset.type !== 'pixel-texture') throw new Error('图集仅接受独立像素贴图');
      return asset;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const cell = Math.max(...textures.map((t) => t.payload.width)) + 2;
  const columns = Math.ceil(Math.sqrt(textures.length));
  const width = columns * cell,
    height = Math.ceil(textures.length / columns) * cell;
  const output = new Uint8ClampedArray(width * height * 4);
  const entries = textures.map((texture, i): AtlasEntry => {
    const { width: w, height: h } = texture.payload;
    const x = (i % columns) * cell + 1,
      y = Math.floor(i / columns) * cell + 1;
    const source = textureRgba(texture);
    for (let dy = -1; dy <= h; dy++)
      for (let dx = -1; dx <= w; dx++) {
        const from = (Math.max(0, Math.min(h - 1, dy)) * w + Math.max(0, Math.min(w - 1, dx))) * 4;
        output.set(source.subarray(from, from + 4), ((y + dy) * width + x + dx) * 4);
      }
    return { id: texture.id, revision: texture.revision, x, y, width: w, height: h };
  });
  return { compilerVersion: 1, width, height, padding: 1, entries, pixels: output };
}
