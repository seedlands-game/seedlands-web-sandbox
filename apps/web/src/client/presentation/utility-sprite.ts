import { Sprite } from './pixel-sprite';

export type UtilitySpriteKind =
  | 'bowl'
  | 'bucket'
  | 'shears'
  | 'minecart'
  | 'chest-minecart'
  | 'furnace-minecart'
  | 'boat'
  | 'bow'
  | 'arrow'
  | 'string'
  | 'feather'
  | 'flint';

const utilityKinds: readonly string[] = [
  'bowl',
  'bucket',
  'shears',
  'minecart',
  'chest-minecart',
  'furnace-minecart',
  'boat',
  'bow',
  'arrow',
  'string',
  'feather',
  'flint',
];
export const isUtilitySpriteKind = (kind: string): kind is UtilitySpriteKind => utilityKinds.includes(kind);

function line(sprite: Sprite, x0: number, y0: number, x1: number, y1: number, color: number) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let step = 0; step <= steps; step++) {
    const ratio = steps === 0 ? 0 : step / steps;
    sprite.put(Math.round(x0 + (x1 - x0) * ratio), Math.round(y0 + (y1 - y0) * ratio), color);
  }
}

/** First-party 32px utility and transport sprites; palette indices share the item ramp. */
export function utilitySprite(kind: UtilitySpriteKind): number[] {
  const sprite = new Sprite();
  if (kind === 'bowl') {
    sprite.polygon(
      [
        [6, 15],
        [26, 15],
        [22, 24],
        [10, 24],
      ],
      3,
    );
    sprite.rect(6, 15, 20, 2, 4);
    sprite.polygon(
      [
        [9, 17],
        [23, 17],
        [20, 22],
        [12, 22],
      ],
      2,
    );
    return sprite.pixels;
  }
  if (kind === 'bucket') {
    sprite.polygon(
      [
        [8, 8],
        [24, 8],
        [22, 26],
        [10, 26],
      ],
      9,
    );
    sprite.rect(8, 8, 16, 2, 11);
    sprite.rect(10, 10, 2, 15, 10);
    sprite.rect(20, 10, 2, 15, 7);
    return sprite.pixels;
  }
  if (kind === 'shears') {
    sprite.polygon(
      [
        [8, 6],
        [16, 16],
        [12, 20],
        [6, 12],
      ],
      9,
    );
    sprite.polygon(
      [
        [24, 6],
        [16, 16],
        [20, 20],
        [26, 12],
      ],
      9,
    );
    sprite.rect(14, 16, 4, 10, 3);
    return sprite.pixels;
  }
  if (kind === 'boat') {
    sprite.polygon(
      [
        [4, 14],
        [28, 14],
        [24, 24],
        [8, 24],
      ],
      3,
    );
    sprite.rect(4, 14, 24, 2, 4);
    sprite.rect(9, 17, 14, 4, 2);
    return sprite.pixels;
  }
  if (kind === 'bow') {
    sprite.polygon(
      [
        [8, 3],
        [13, 5],
        [18, 11],
        [20, 16],
        [18, 21],
        [13, 27],
        [8, 29],
        [11, 25],
        [15, 20],
        [17, 16],
        [15, 12],
        [11, 7],
      ],
      3,
    );
    line(sprite, 8, 3, 8, 29, 10);
    return sprite.pixels;
  }
  if (kind === 'arrow') {
    line(sprite, 6, 25, 24, 7, 3);
    line(sprite, 7, 26, 25, 8, 4);
    sprite.polygon(
      [
        [21, 5],
        [28, 3],
        [26, 10],
      ],
      9,
    );
    sprite.polygon(
      [
        [5, 21],
        [3, 29],
        [11, 27],
      ],
      10,
    );
    return sprite.pixels;
  }
  if (kind === 'string') {
    line(sprite, 7, 7, 24, 24, 10);
    line(sprite, 24, 7, 7, 24, 11);
    sprite.rect(13, 13, 6, 6, 9);
    return sprite.pixels;
  }
  if (kind === 'feather') {
    sprite.polygon(
      [
        [8, 25],
        [10, 10],
        [18, 4],
        [25, 6],
        [24, 14],
        [15, 23],
      ],
      10,
    );
    line(sprite, 8, 26, 22, 8, 11);
    return sprite.pixels;
  }
  if (kind === 'flint') {
    sprite.polygon(
      [
        [7, 14],
        [13, 7],
        [24, 9],
        [27, 17],
        [20, 25],
        [9, 23],
      ],
      7,
    );
    sprite.polygon(
      [
        [12, 10],
        [22, 11],
        [24, 16],
        [17, 20],
        [10, 19],
      ],
      9,
    );
    return sprite.pixels;
  }
  // minecart family: an iron cart, tinted body for variants.
  const body = kind === 'furnace-minecart' ? 8 : kind === 'chest-minecart' ? 3 : 9;
  sprite.polygon(
    [
      [6, 10],
      [26, 10],
      [24, 22],
      [8, 22],
    ],
    body,
  );
  sprite.rect(6, 10, 20, 2, 11);
  sprite.rect(9, 13, 14, 6, 7);
  sprite.rect(10, 24, 3, 3, 1);
  sprite.rect(19, 24, 3, 3, 1);
  return sprite.pixels;
}
