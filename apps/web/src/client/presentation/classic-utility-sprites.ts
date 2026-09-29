import { Sprite } from './pixel-sprite';

export const classicSpecialUtilityKinds = [
  'sapling',
  'flower',
  'mushroom',
  'sugar-cane',
  'dead-bush',
  'red-flower',
  'red-mushroom',
  'mushroom-stew',
  'cookie',
  'golden-apple',
  'cake',
  'leather',
] as const;
export type ClassicSpecialUtilityKind = (typeof classicSpecialUtilityKinds)[number];
export const isClassicSpecialUtilityKind = (kind: string): kind is ClassicSpecialUtilityKind =>
  (classicSpecialUtilityKinds as readonly string[]).includes(kind);

function line(sprite: Sprite, x0: number, y0: number, x1: number, y1: number, color: number) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let step = 0; step <= steps; step++) {
    const ratio = steps === 0 ? 0 : step / steps;
    sprite.put(Math.round(x0 + (x1 - x0) * ratio), Math.round(y0 + (y1 - y0) * ratio), color);
  }
}

export function classicSpecialUtilitySprite(kind: ClassicSpecialUtilityKind): number[] {
  const sprite = new Sprite();
  if (kind === 'leather') {
    sprite.polygon(
      [
        [7, 10],
        [13, 6],
        [23, 8],
        [26, 15],
        [22, 24],
        [12, 26],
        [6, 20],
      ],
      2,
    );
    sprite.polygon(
      [
        [9, 11],
        [14, 8],
        [21, 10],
        [23, 16],
        [20, 22],
        [13, 23],
        [8, 19],
      ],
      3,
    );
    sprite.rect(11, 12, 8, 1, 4);
    sprite.put(19, 19, 4);
    return sprite.pixels;
  }
  if (['sapling', 'flower', 'mushroom', 'sugar-cane', 'dead-bush', 'red-flower', 'red-mushroom'].includes(kind)) {
    const red = kind === 'flower' || kind === 'red-flower' || kind === 'red-mushroom';
    if (kind === 'sugar-cane') {
      sprite.rect(8, 5, 4, 23, 8);
      sprite.rect(14, 3, 4, 25, 9);
      sprite.rect(20, 7, 4, 21, 8);
      sprite.rect(9, 6, 1, 20, 6);
      return sprite.pixels;
    }
    if (kind === 'dead-bush') {
      line(sprite, 16, 27, 16, 13, 3);
      line(sprite, 16, 18, 8, 10, 4);
      line(sprite, 16, 20, 24, 11, 4);
      line(sprite, 12, 14, 7, 15, 3);
      line(sprite, 20, 15, 25, 16, 3);
      return sprite.pixels;
    }
    if (kind === 'mushroom' || kind === 'red-mushroom') {
      sprite.rect(14, 17, 5, 10, 10);
      sprite.polygon(
        [
          [7, 17],
          [10, 9],
          [22, 8],
          [26, 16],
          [24, 19],
          [8, 19],
        ],
        red ? 16 : 3,
      );
      if (red) {
        sprite.rect(12, 12, 3, 3, 11);
        sprite.rect(20, 15, 2, 2, 11);
      }
      return sprite.pixels;
    }
    line(sprite, 16, 27, 16, 14, 8);
    sprite.rect(11, 21, 5, 3, 8);
    sprite.rect(17, 18, 5, 3, 8);
    if (kind === 'sapling')
      sprite.polygon(
        [
          [16, 5],
          [24, 13],
          [20, 18],
          [12, 18],
          [8, 13],
        ],
        8,
      );
    else {
      const bloom = red ? 16 : 13;
      sprite.rect(12, 8, 8, 8, bloom);
      sprite.rect(9, 11, 14, 3, bloom);
      sprite.rect(14, 10, 4, 4, 14);
    }
    return sprite.pixels;
  }
  if (kind === 'mushroom-stew') {
    sprite.polygon(
      [
        [6, 15],
        [26, 15],
        [22, 25],
        [10, 25],
      ],
      3,
    );
    sprite.rect(7, 14, 18, 3, 4);
    sprite.rect(10, 12, 12, 3, 16);
    sprite.rect(12, 10, 3, 3, 1);
    sprite.rect(18, 10, 3, 3, 1);
  } else if (kind === 'cookie') {
    sprite.polygon(
      [
        [9, 8],
        [20, 7],
        [26, 13],
        [26, 21],
        [20, 26],
        [10, 25],
        [6, 19],
        [6, 12],
      ],
      3,
    );
    sprite.polygon(
      [
        [10, 10],
        [19, 9],
        [24, 14],
        [23, 20],
        [19, 23],
        [11, 22],
        [8, 18],
        [8, 13],
      ],
      5,
    );
    for (const [x, y] of [
      [12, 13],
      [19, 12],
      [16, 18],
      [21, 20],
      [11, 19],
    ])
      sprite.rect(x, y, 2, 2, 1);
  } else if (kind === 'golden-apple') {
    sprite.polygon(
      [
        [9, 10],
        [16, 7],
        [23, 10],
        [25, 18],
        [21, 25],
        [11, 25],
        [7, 18],
      ],
      12,
    );
    sprite.polygon(
      [
        [11, 11],
        [16, 9],
        [21, 11],
        [23, 18],
        [19, 23],
        [12, 23],
        [9, 18],
      ],
      13,
    );
    sprite.rect(12, 13, 3, 4, 14);
    sprite.rect(16, 5, 2, 4, 3);
  } else {
    sprite.rect(7, 13, 18, 12, 10);
    sprite.rect(8, 11, 16, 4, 11);
    sprite.rect(9, 16, 14, 6, 17);
    sprite.rect(12, 11, 2, 2, 16);
    sprite.rect(19, 11, 2, 2, 16);
  }
  return sprite.pixels;
}
