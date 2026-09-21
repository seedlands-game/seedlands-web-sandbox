import type { NativeAsset, Rgb } from './asset-types';

const colors = [
  ['white', '白色', '#e8e8df'],
  ['orange', '橙色', '#d97819'],
  ['magenta', '品红色', '#b24aac'],
  ['light-blue', '淡蓝色', '#6699d8'],
  ['yellow', '黄色', '#c9b51a'],
  ['lime', '黄绿色', '#74a82d'],
  ['pink', '粉红色', '#d98199'],
  ['gray', '灰色', '#4c5355'],
  ['light-gray', '淡灰色', '#9aa1a1'],
  ['cyan', '青色', '#2f8b8d'],
  ['purple', '紫色', '#7043a3'],
  ['blue', '蓝色', '#334f9b'],
  ['brown', '棕色', '#70462a'],
  ['green', '绿色', '#446b25'],
  ['red', '红色', '#a83232'],
  ['black', '黑色', '#202428'],
] as const;
const rgb = (hex: string): Rgb => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)) as Rgb;
export const dyeItemNames = colors.map(([id, name]) => [`${id}-dye`, `${name}染料`] as const);
export const dyeItemAssets: NativeAsset[] = colors.flatMap(([id, name, color]) => {
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
