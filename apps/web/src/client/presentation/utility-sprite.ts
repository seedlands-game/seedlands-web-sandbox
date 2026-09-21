import { Sprite } from './pixel-sprite';

export type UtilitySpriteKind =
  'bowl' | 'bucket' | 'shears' | 'minecart' | 'chest-minecart' | 'furnace-minecart' | 'boat';

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
