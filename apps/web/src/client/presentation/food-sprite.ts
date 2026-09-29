import { Sprite } from './pixel-sprite';

export type FoodSpriteKind =
  'apple' | 'bread' | 'raw-porkchop' | 'cooked-porkchop' | 'raw-fish' | 'cooked-fish' | 'wheat' | 'wheat-seeds';

/** First-party 32px food sprites; palette indices match the shared item ramp. */
export function foodSprite(kind: FoodSpriteKind): number[] {
  const sprite = new Sprite();
  if (kind === 'apple') {
    // Round fruit body with a highlight and a short stem.
    sprite.polygon(
      [
        [9, 9],
        [16, 7],
        [23, 9],
        [26, 16],
        [23, 24],
        [16, 27],
        [9, 24],
        [6, 16],
      ],
      2,
    );
    sprite.polygon(
      [
        [10, 10],
        [16, 9],
        [22, 10],
        [24, 16],
        [22, 22],
        [16, 25],
        [10, 22],
        [8, 16],
      ],
      17,
    );
    sprite.rect(11, 12, 4, 5, 6);
    sprite.rect(16, 6, 2, 4, 3);
    sprite.polygon(
      [
        [18, 7],
        [23, 5],
        [22, 9],
      ],
      8,
    );
    return sprite.pixels;
  }
  if (kind === 'bread') {
    sprite.polygon(
      [
        [6, 12],
        [12, 8],
        [22, 9],
        [27, 15],
        [24, 23],
        [10, 23],
        [5, 17],
      ],
      2,
    );
    sprite.polygon(
      [
        [8, 13],
        [13, 10],
        [21, 11],
        [25, 16],
        [22, 21],
        [11, 21],
        [7, 16],
      ],
      13,
    );
    for (const x of [12, 16, 20]) sprite.rect(x, 12, 1, 8, 3);
    sprite.rect(9, 14, 14, 1, 14);
    return sprite.pixels;
  }
  if (kind === 'raw-porkchop' || kind === 'cooked-porkchop') {
    const [flesh, edge] = kind === 'cooked-porkchop' ? [3, 2] : [17, 16];
    sprite.polygon(
      [
        [7, 12],
        [14, 8],
        [24, 10],
        [26, 18],
        [20, 24],
        [10, 23],
        [6, 17],
      ],
      edge,
    );
    sprite.polygon(
      [
        [9, 13],
        [15, 10],
        [22, 12],
        [24, 18],
        [19, 22],
        [11, 21],
        [8, 16],
      ],
      flesh,
    );
    sprite.rect(20, 10, 3, 3, 11);
    return sprite.pixels;
  }
  if (kind === 'raw-fish' || kind === 'cooked-fish') {
    const body = kind === 'cooked-fish' ? 4 : 9;
    sprite.polygon(
      [
        [6, 16],
        [16, 10],
        [24, 13],
        [26, 16],
        [24, 19],
        [16, 22],
        [6, 16],
      ],
      body,
    );
    sprite.polygon(
      [
        [24, 13],
        [29, 10],
        [29, 22],
        [24, 19],
      ],
      body,
    );
    sprite.put(11, 15, 1);
    sprite.rect(14, 14, 6, 1, 11);
    return sprite.pixels;
  }
  if (kind === 'wheat-seeds') {
    // Scattered seed grains with husk flecks.
    for (const [x, y] of [
      [10, 12],
      [15, 9],
      [20, 13],
      [13, 18],
      [19, 19],
      [16, 15],
    ] as const) {
      sprite.rect(x, y, 3, 2, 6);
      sprite.put(x, y, 14);
      sprite.put(x + 2, y + 1, 3);
    }
    return sprite.pixels;
  }
  // wheat
  for (let i = 0; i < 3; i++) {
    const x = 10 + i * 4;
    sprite.rect(x, 8, 2, 18, 3);
    for (let y = 9; y < 20; y += 3) {
      sprite.put(x - 1, y, 14);
      sprite.put(x + 2, y + 1, 14);
    }
    sprite.rect(x, 6, 2, 3, 6);
  }
  return sprite.pixels;
}
