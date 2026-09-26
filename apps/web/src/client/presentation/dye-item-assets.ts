import type { NativeAsset, Rgb } from './asset-types';
import { woolVoxelColors } from '@seedlands/stdlib/world/wool-colors';

export const woolColors = woolVoxelColors.map(([id, name, , , color]) => [id, name, color] as const);
const rgb = (hex: string): Rgb => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)) as Rgb;
export const dyeItemNames = woolColors.map(([id, name]) => [`${id}-dye`, `${name}染料`] as const);
export const woolItemNames = woolColors.map(([id, name]) => [`${id}-wool`, `${name}羊毛`] as const);
export const dyeItemAssets: NativeAsset[] = woolColors.flatMap(([id, name, color]) => {
  const itemId = `${id}-dye`,
    textureId = `builtin:texture:${itemId}:detail`;
  const pixels = Array.from({ length: 1024 }, (_, index) => {
    const x = index % 32,
      y = Math.floor(index / 32),
      dx = x - 15.5,
      dy = y - 17;
    return (dx * dx) / 100 + (dy * dy) / 144 < 1 && y > 5 + Math.abs(dx) * 0.35 ? ((x + y) % 7 ? 1 : 2) : 0;
  });
  return [
    {
      id: textureId,
      name: `${name}染料像素`,
      source: 'builtin',
      revision: 1,
      type: 'pixel-texture',
      payload: { width: 32, height: 32, palette: [[0, 0, 0], rgb(color), [255, 255, 255]], pixels },
    },
    {
      id: `builtin:model:${itemId}`,
      name: `${name}染料`,
      source: 'builtin',
      revision: 1,
      type: 'extruded-pixel-model',
      payload: { textureId, pixelsPerUnit: 16, thicknessPixels: 2, grip: [15.5, 23], generatorVersion: 1 },
    },
  ];
});

const woolPixels = () => {
  const pixels = Array<number>(32 * 32).fill(0);
  for (let y = 7; y <= 25; y++)
    for (let x = 6; x <= 25; x++) {
      const edge = x === 6 || x === 25 || y === 7 || y === 25;
      const curl = (x * 3 + y * 5) % 7 === 0;
      pixels[y * 32 + x] = edge ? 1 : curl ? 3 : (x + y) % 5 === 0 ? 2 : 1;
    }
  return pixels;
};

/** Each dye family gets its own ramp and texture asset; no colored-wool binding aliases white wool. */
export const woolItemAssets: NativeAsset[] = woolColors.flatMap(([id, name, color]) => {
  const textureId = `builtin:texture:${id}-wool:detail`;
  const base = rgb(color);
  const dark = base.map((channel) => Math.round(channel * 0.58)) as Rgb;
  const light = base.map((channel) => Math.min(255, Math.round(channel * 1.18 + 7))) as Rgb;
  return [
    {
      id: textureId,
      name: `${name}羊毛像素`,
      source: 'builtin',
      revision: 3,
      type: 'pixel-texture',
      payload: { width: 32, height: 32, palette: [[0, 0, 0], base, dark, light], pixels: woolPixels() },
    },
    {
      id: `builtin:model:${id}-wool`,
      name: `${name}羊毛`,
      source: 'builtin',
      revision: 3,
      type: 'extruded-pixel-model',
      payload: { textureId, pixelsPerUnit: 32, thicknessPixels: 4, grip: [15.5, 23], generatorVersion: 1 },
    },
  ];
});
