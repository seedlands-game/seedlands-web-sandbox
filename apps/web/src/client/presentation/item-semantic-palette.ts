import type { Rgb } from './asset-types';
import { palette } from './pixel-sprite';

const semanticPaletteKinds = new Set<string>([
  'apple',
  'bread',
  'raw-porkchop',
  'cooked-porkchop',
  'raw-fish',
  'cooked-fish',
  'wheat',
  'wheat-seeds',
  'sapling',
  'flower',
  'mushroom',
  'sugar-cane',
  'dead-bush',
  'red-flower',
  'red-mushroom',
  'leather',
  'water-bucket',
  'milk-bucket',
  'lava-bucket',
  'mushroom-stew',
  'golden-apple',
  'cake',
  'cookie',
  'redstone-dust',
  'compass',
  'clock',
  'painting',
  'cocoa-beans',
]);

/** Keeps legacy tool/armor indices stable while assigning real colors to organic item art. */
export function paletteForItem(kind: string): Rgb[] {
  if (!semanticPaletteKinds.has(kind)) return palette.map((color) => [...color] as Rgb);
  const semantic: Rgb[] = [
    [0, 0, 0],
    [52, 35, 28],
    [103, 62, 37],
    [151, 91, 49],
    [196, 137, 75],
    [218, 166, 91],
    [239, 205, 132],
    [48, 76, 42],
    [68, 124, 57],
    [91, 154, 70],
    [224, 220, 194],
    [247, 244, 218],
    [177, 112, 30],
    [219, 171, 43],
    [250, 219, 97],
    [65, 57, 51],
    [190, 52, 48],
    [234, 102, 61],
    [42, 109, 145],
    [57, 144, 177],
    [98, 183, 205],
    [205, 241, 231],
  ];
  if (kind === 'raw-fish') semantic[9] = [132, 151, 153];
  if (kind === 'compass' || kind === 'clock') semantic[9] = [91, 104, 106];
  return semantic;
}
