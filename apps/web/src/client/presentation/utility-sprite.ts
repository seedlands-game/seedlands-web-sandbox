import { Sprite } from './pixel-sprite';
import { classicSpecialUtilitySprite, isClassicSpecialUtilityKind } from './classic-utility-sprites';
import { cocoaBeanSprite } from './cocoa-bean-sprite';
import { spriteLine } from './sprite-line';

export type UtilitySpriteKind =
  | 'bowl'
  | 'bucket'
  | 'water-bucket'
  | 'milk-bucket'
  | 'lava-bucket'
  | 'shears'
  | 'minecart'
  | 'chest-minecart'
  | 'furnace-minecart'
  | 'boat'
  | 'bow'
  | 'arrow'
  | 'string'
  | 'feather'
  | 'flint'
  | 'wool'
  | 'leather'
  | 'ink-sac'
  | 'rotten-flesh'
  | 'bone'
  | 'gunpowder'
  | 'slimeball'
  | 'bed'
  | 'saddle'
  | 'egg'
  | 'fishing-rod'
  | 'paper'
  | 'redstone-dust'
  | 'compass'
  | 'clock'
  | 'map'
  | 'flint-and-steel'
  | 'mushroom-stew'
  | 'painting'
  | 'golden-apple'
  | 'sign'
  | 'wooden-door'
  | 'snowball'
  | 'brick'
  | 'clay'
  | 'book'
  | 'sugar'
  | 'cake'
  | 'cookie'
  | 'cocoa-beans'
  | 'record-13'
  | 'record-cat'
  | 'sapling'
  | 'flower'
  | 'mushroom'
  | 'sugar-cane'
  | 'dead-bush'
  | 'red-flower'
  | 'red-mushroom';

const utilityKinds: readonly string[] = [
  'bowl',
  'bucket',
  'water-bucket',
  'milk-bucket',
  'lava-bucket',
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
  'wool',
  'leather',
  'ink-sac',
  'rotten-flesh',
  'bone',
  'gunpowder',
  'slimeball',
  'bed',
  'saddle',
  'egg',
  'fishing-rod',
  'paper',
  'redstone-dust',
  'compass',
  'clock',
  'map',
  'flint-and-steel',
  'mushroom-stew',
  'painting',
  'golden-apple',
  'sign',
  'wooden-door',
  'snowball',
  'brick',
  'clay',
  'book',
  'sugar',
  'cake',
  'cookie',
  'cocoa-beans',
  'record-13',
  'record-cat',
  'sapling',
  'flower',
  'mushroom',
  'sugar-cane',
  'dead-bush',
  'red-flower',
  'red-mushroom',
];
export const isUtilitySpriteKind = (kind: string): kind is UtilitySpriteKind => utilityKinds.includes(kind);

/** First-party 32px utility and transport sprites; palette indices share the item ramp. */
export function utilitySprite(kind: UtilitySpriteKind): number[] {
  if (isClassicSpecialUtilityKind(kind)) return classicSpecialUtilitySprite(kind);
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
  if (kind === 'bucket' || kind === 'water-bucket' || kind === 'milk-bucket' || kind === 'lava-bucket') {
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
    if (kind !== 'bucket') {
      const contents = kind === 'water-bucket' ? 18 : kind === 'milk-bucket' ? 10 : 16;
      sprite.rect(12, 14, 8, 9, contents);
      sprite.rect(12, 14, 8, 2, kind === 'lava-bucket' ? 17 : 11);
      if (kind === 'water-bucket') sprite.rect(14, 18, 3, 2, 20);
      if (kind === 'lava-bucket') {
        sprite.put(14, 18, 14);
        sprite.put(18, 21, 14);
      }
    }
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
    spriteLine(sprite, 8, 3, 8, 29, 10);
    return sprite.pixels;
  }
  if (kind === 'arrow') {
    spriteLine(sprite, 6, 25, 24, 7, 3);
    spriteLine(sprite, 7, 26, 25, 8, 4);
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
    spriteLine(sprite, 7, 7, 24, 24, 10);
    spriteLine(sprite, 24, 7, 7, 24, 11);
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
    spriteLine(sprite, 8, 26, 22, 8, 11);
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
  if (kind === 'wool') {
    sprite.rect(7, 8, 18, 17, 10);
    sprite.rect(9, 6, 6, 4, 11);
    sprite.rect(17, 7, 7, 4, 9);
    sprite.rect(10, 23, 12, 4, 9);
    return sprite.pixels;
  }
  if (kind === 'bone') {
    spriteLine(sprite, 8, 24, 24, 8, 10);
    spriteLine(sprite, 9, 25, 25, 9, 11);
    sprite.rect(5, 23, 6, 5, 9);
    sprite.rect(22, 5, 6, 5, 9);
    return sprite.pixels;
  }
  if (kind === 'bed') {
    sprite.rect(4, 10, 24, 13, 16);
    sprite.rect(5, 11, 22, 5, 10);
    sprite.rect(5, 16, 22, 6, 17);
    sprite.rect(6, 23, 3, 5, 3);
    sprite.rect(23, 23, 3, 5, 3);
    return sprite.pixels;
  }
  if (kind === 'saddle') {
    sprite.polygon(
      [
        [7, 11],
        [13, 6],
        [24, 8],
        [27, 15],
        [22, 23],
        [10, 22],
        [5, 17],
      ],
      3,
    );
    sprite.rect(10, 10, 13, 8, 4);
    sprite.rect(7, 17, 5, 9, 2);
    sprite.rect(21, 17, 4, 8, 2);
    return sprite.pixels;
  }
  if (kind === 'egg') {
    sprite.polygon(
      [
        [16, 5],
        [22, 10],
        [25, 20],
        [21, 27],
        [11, 27],
        [7, 20],
        [10, 10],
      ],
      10,
    );
    sprite.rect(12, 9, 6, 14, 11);
    return sprite.pixels;
  }
  if (kind === 'fishing-rod') {
    spriteLine(sprite, 7, 27, 23, 6, 3);
    spriteLine(sprite, 8, 27, 24, 6, 4);
    spriteLine(sprite, 24, 6, 27, 22, 10);
    sprite.rect(25, 22, 4, 4, 16);
    return sprite.pixels;
  }
  if (kind === 'paper' || kind === 'map') {
    sprite.rect(6, 5, 20, 23, 10);
    sprite.rect(8, 7, 16, 19, kind === 'map' ? 2 : 11);
    if (kind === 'map') {
      sprite.rect(11, 10, 5, 6, 18);
      sprite.rect(17, 16, 5, 7, 1);
    }
    return sprite.pixels;
  }
  if (kind === 'redstone-dust') {
    sprite.polygon(
      [
        [16, 5],
        [21, 12],
        [28, 16],
        [21, 20],
        [16, 27],
        [11, 20],
        [4, 16],
        [11, 12],
      ],
      16,
    );
    sprite.rect(13, 13, 7, 7, 17);
    return sprite.pixels;
  }
  if (kind === 'compass' || kind === 'clock') {
    sprite.polygon(
      [
        [16, 3],
        [25, 7],
        [29, 16],
        [25, 25],
        [16, 29],
        [7, 25],
        [3, 16],
        [7, 7],
      ],
      9,
    );
    sprite.polygon(
      [
        [16, 6],
        [23, 9],
        [26, 16],
        [23, 23],
        [16, 26],
        [9, 23],
        [6, 16],
        [9, 9],
      ],
      kind === 'clock' ? 13 : 10,
    );
    if (kind === 'clock') {
      spriteLine(sprite, 16, 16, 22, 16, 3);
      spriteLine(sprite, 16, 16, 16, 9, 16);
      sprite.rect(15, 15, 3, 3, 14);
    } else {
      spriteLine(sprite, 16, 16, 16, 7, 16);
      spriteLine(sprite, 16, 16, 12, 22, 18);
      sprite.rect(15, 15, 3, 3, 11);
    }
    return sprite.pixels;
  }
  if (kind === 'cocoa-beans') return cocoaBeanSprite();
  if (kind === 'snowball' || kind === 'clay' || kind === 'sugar') {
    const color = kind === 'snowball' || kind === 'sugar' ? 10 : 9;
    sprite.polygon(
      [
        [16, 5],
        [24, 9],
        [28, 17],
        [23, 25],
        [14, 28],
        [6, 22],
        [5, 13],
        [10, 7],
      ],
      color,
    );
    sprite.rect(11, 9, 7, 4, 11);
    return sprite.pixels;
  }
  if (kind === 'painting') {
    sprite.rect(5, 6, 22, 21, 3);
    sprite.rect(7, 8, 18, 17, 18);
    sprite.rect(8, 18, 16, 6, 8);
    sprite.rect(10, 14, 7, 5, 7);
    sprite.rect(19, 10, 3, 3, 14);
    return sprite.pixels;
  }
  if (kind === 'book' || kind === 'sign' || kind === 'wooden-door') {
    sprite.rect(6, 5, 20, 23, kind === 'book' ? 16 : 3);
    sprite.rect(9, 8, 14, 17, 4);
    return sprite.pixels;
  }
  if (kind === 'record-13' || kind === 'record-cat') {
    sprite.rect(5, 5, 22, 22, 1);
    sprite.rect(9, 9, 14, 14, kind === 'record-cat' ? 18 : 13);
    sprite.rect(14, 14, 4, 4, 1);
    return sprite.pixels;
  }
  if (kind === 'flint-and-steel') {
    spriteLine(sprite, 7, 25, 23, 7, 9);
    sprite.rect(6, 20, 8, 7, 7);
    return sprite.pixels;
  }
  if (kind === 'brick') {
    sprite.rect(6, 9, 20, 15, 16);
    sprite.rect(8, 7, 16, 3, 17);
    return sprite.pixels;
  }
  if (kind === 'ink-sac' || kind === 'rotten-flesh' || kind === 'gunpowder' || kind === 'slimeball') {
    const colors =
      kind === 'ink-sac' ? [1, 15] : kind === 'rotten-flesh' ? [3, 5] : kind === 'gunpowder' ? [7, 9] : [18, 19];
    sprite.polygon(
      [
        [8, 9],
        [18, 5],
        [25, 11],
        [27, 21],
        [20, 27],
        [9, 24],
        [5, 16],
      ],
      colors[0],
    );
    sprite.rect(11, 10, 10, 4, colors[1]);
    sprite.rect(9, 17, 7, 5, colors[1]);
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
