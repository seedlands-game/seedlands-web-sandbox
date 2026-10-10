import { Sprite } from './pixel-sprite';

export type ArmorSpriteKind = 'armor-helmet' | 'armor-chestplate' | 'armor-leggings' | 'armor-boots';

// Palette ramp indices mirror the shared item ramp used by tools.
const RAMP: Record<string, [number, number, number, number]> = {
  leather: [2, 3, 4, 5],
  iron: [7, 9, 10, 11],
  gold: [12, 13, 14, 6],
  diamond: [18, 19, 20, 21],
};

/** First-party 32px armor silhouettes keyed by slot and material tier. */
export function armorSprite(kind: ArmorSpriteKind, material: 'leather' | 'iron' | 'gold' | 'diamond'): number[] {
  const sprite = new Sprite();
  const [dark, base, light, edge] = RAMP[material];
  if (kind === 'armor-helmet') {
    sprite.polygon(
      [
        [8, 6],
        [24, 6],
        [25, 18],
        [21, 20],
        [21, 14],
        [11, 14],
        [11, 20],
        [7, 18],
      ],
      base,
    );
    sprite.rect(8, 6, 16, 2, edge);
    sprite.rect(8, 8, 2, 10, light);
    sprite.rect(22, 8, 2, 10, dark);
    sprite.rect(11, 14, 10, 1, dark);
    return sprite.pixels;
  }
  if (kind === 'armor-chestplate') {
    sprite.polygon(
      [
        [7, 6],
        [12, 6],
        [16, 9],
        [20, 6],
        [25, 6],
        [25, 26],
        [7, 26],
      ],
      base,
    );
    sprite.rect(7, 6, 18, 2, edge);
    sprite.rect(7, 8, 2, 18, light);
    sprite.rect(23, 8, 2, 18, dark);
    sprite.rect(14, 12, 4, 10, dark);
    return sprite.pixels;
  }
  if (kind === 'armor-leggings') {
    sprite.rect(8, 5, 16, 6, base);
    sprite.rect(8, 11, 6, 16, base);
    sprite.rect(18, 11, 6, 16, base);
    sprite.rect(8, 5, 16, 2, edge);
    sprite.rect(8, 11, 2, 16, light);
    sprite.rect(22, 11, 2, 16, dark);
    return sprite.pixels;
  }
  // boots
  sprite.rect(7, 10, 8, 12, base);
  sprite.rect(17, 10, 8, 12, base);
  sprite.rect(7, 20, 12, 6, base);
  sprite.rect(17, 20, 8, 6, base);
  sprite.rect(7, 10, 8, 2, edge);
  sprite.rect(17, 10, 8, 2, edge);
  sprite.rect(7, 24, 18, 2, light);
  return sprite.pixels;
}
