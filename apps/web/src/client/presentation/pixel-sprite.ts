import type { Rgb } from './asset-types';

// Shared 32px material ramps: dark edges, warm timber/brass, cool stone and iron.
const colors = [
  '000000',
  '322b27',
  '68442f',
  '986239',
  'bd884d',
  'e1b76d',
  'f4d99c',
  '35474b',
  '617477',
  '93a4a0',
  'c0ccc3',
  'e9eee0',
  '95622f',
  'c18b41',
  'ebc774',
  '4d5757',
  '94705c',
  'c59470',
  '20616b',
  '399da5',
  '7edbd5',
  'c8fff0',
];
export const palette: Rgb[] = colors.map(
  (hex) => [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as Rgb,
);
export type Point = readonly [number, number];

export class Sprite {
  readonly pixels = Array<number>(32 * 32).fill(0);
  put(x: number, y: number, color: number) {
    if (x >= 0 && y >= 0 && x < 32 && y < 32) this.pixels[y * 32 + x] = color;
  }
  rect(x: number, y: number, width: number, height: number, color: number) {
    for (let row = y; row < y + height; row++)
      for (let column = x; column < x + width; column++) this.put(column, row, color);
  }
  polygon(points: readonly Point[], color: number) {
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const [a, b] = points[i],
            [c, d] = points[j];
          if (b > y + 0.5 !== d > y + 0.5 && x + 0.5 < ((c - a) * (y + 0.5 - b)) / (d - b) + a) inside = !inside;
        }
        if (inside) this.put(x, y, color);
      }
  }
}
