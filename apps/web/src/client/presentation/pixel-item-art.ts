import type { NativeAsset } from './asset-types';
import { palette, Sprite } from './pixel-sprite';
import { foodSprite, type FoodSpriteKind } from './food-sprite';

function handle(sprite: Sprite) {
  sprite.rect(13, 7, 5, 23, 1);
  sprite.rect(14, 8, 3, 21, 3);
  sprite.rect(14, 9, 1, 19, 5);
  sprite.rect(16, 8, 1, 21, 2);
  for (const y of [17, 21, 25]) {
    sprite.rect(14, y, 3, 1, 2);
    sprite.put(14, y + 1, 4);
  }
  sprite.rect(13, 27, 5, 2, 12);
  sprite.rect(14, 27, 3, 1, 14);
}

function tool(
  kind: 'pickaxe' | 'axe' | 'sword' | 'shovel' | 'hoe',
  material: 'wood' | 'stone' | 'iron' | 'gold' | 'diamond',
) {
  const sprite = new Sprite();
  const [dark, base, light, edge] =
    material === 'wood'
      ? [2, 3, 4, 5]
      : material === 'stone'
        ? [7, 8, 9, 10]
        : material === 'gold'
          ? [12, 13, 14, 6]
          : material === 'diamond'
            ? [18, 19, 20, 21]
            : [7, 9, 10, 11];
  if (kind === 'sword') {
    sprite.polygon(
      [
        [16, 1],
        [19, 5],
        [19, 20],
        [21, 20],
        [21, 23],
        [18, 23],
        [18, 29],
        [13, 29],
        [13, 23],
        [9, 23],
        [9, 20],
        [13, 20],
        [13, 5],
      ],
      1,
    );
    sprite.polygon(
      [
        [16, 3],
        [18, 6],
        [18, 20],
        [14, 20],
        [14, 6],
      ],
      base,
    );
    sprite.rect(14, 6, 1, 14, light);
    sprite.rect(15, 5, 1, 15, edge);
    sprite.rect(17, 6, 1, 14, dark);
    sprite.put(15, 4, 6);
    sprite.rect(10, 20, 10, 2, 12);
    sprite.rect(10, 20, 10, 1, 14);
    sprite.rect(14, 23, 3, 5, 2);
    for (const y of [23, 25, 27]) sprite.rect(14, y, 2, 1, 4);
    sprite.rect(13, 28, 5, 1, 13);
  } else {
    handle(sprite);
    if (kind === 'pickaxe') {
      sprite.polygon(
        [
          [7, 3],
          [22, 3],
          [26, 6],
          [29, 13],
          [29, 17],
          [26, 15],
          [23, 9],
          [19, 8],
          [11, 8],
          [7, 10],
          [3, 15],
          [2, 12],
          [4, 7],
        ],
        1,
      );
      sprite.polygon(
        [
          [7, 4],
          [22, 4],
          [25, 7],
          [28, 14],
          [26, 13],
          [22, 8],
          [10, 7],
          [6, 10],
          [3, 13],
          [5, 8],
        ],
        dark,
      );
      sprite.polygon(
        [
          [8, 4],
          [21, 4],
          [24, 6],
          [26, 10],
          [22, 7],
          [10, 6],
          [6, 9],
          [4, 11],
          [6, 7],
        ],
        light,
      );
      sprite.rect(9, 4, 12, 1, edge);
      sprite.rect(10, 6, 12, 1, base);
      sprite.put(24, 8, edge);
      if (material === 'stone') {
        sprite.rect(9, 5, 3, 1, 8);
        sprite.put(20, 6, 7);
      }
    } else if (kind === 'shovel') {
      // Compact scoop head on the shared handle; a readable spade silhouette.
      sprite.polygon(
        [
          [11, 2],
          [21, 2],
          [23, 5],
          [23, 13],
          [20, 16],
          [12, 16],
          [9, 13],
          [9, 5],
        ],
        1,
      );
      sprite.polygon(
        [
          [12, 3],
          [20, 3],
          [22, 6],
          [22, 12],
          [19, 15],
          [13, 15],
          [10, 12],
          [10, 6],
        ],
        base,
      );
      sprite.rect(12, 4, 8, 1, edge);
      sprite.rect(11, 5, 2, 8, light);
      sprite.rect(19, 5, 2, 8, dark);
      sprite.rect(13, 13, 6, 1, dark);
    } else if (kind === 'hoe') {
      // Angled blade on the shared handle: a right-angle head atop the shaft.
      sprite.polygon(
        [
          [7, 3],
          [21, 3],
          [21, 8],
          [16, 8],
          [16, 6],
          [7, 6],
        ],
        1,
      );
      sprite.polygon(
        [
          [8, 4],
          [20, 4],
          [20, 7],
          [15, 7],
          [15, 5],
          [8, 5],
        ],
        base,
      );
      sprite.rect(8, 4, 12, 1, edge);
      sprite.rect(8, 5, 1, 2, light);
      sprite.rect(19, 5, 1, 2, dark);
    } else {
      sprite.polygon(
        [
          [14, 3],
          [22, 3],
          [26, 6],
          [29, 11],
          [28, 15],
          [24, 18],
          [19, 16],
          [18, 11],
          [14, 10],
        ],
        1,
      );
      sprite.polygon(
        [
          [16, 4],
          [22, 4],
          [25, 7],
          [28, 11],
          [27, 14],
          [24, 17],
          [20, 15],
          [19, 10],
          [16, 9],
        ],
        base,
      );
      sprite.polygon(
        [
          [18, 4],
          [22, 4],
          [25, 7],
          [27, 10],
          [25, 10],
          [22, 7],
          [18, 6],
        ],
        edge,
      );
      sprite.polygon(
        [
          [25, 8],
          [28, 11],
          [27, 14],
          [24, 17],
          [23, 15],
          [25, 12],
        ],
        light,
      );
      sprite.rect(19, 8, 2, 6, dark);
    }
    sprite.rect(13, 9, 5, 3, 12);
    sprite.rect(14, 9, 3, 1, 14);
    sprite.put(15, 10, 6);
  }
  return sprite.pixels;
}

function resource(
  kind:
    | 'coal'
    | 'raw-iron'
    | 'iron-ingot'
    | 'gold-ingot'
    | 'diamond'
    | 'stick'
    | 'apple'
    | 'bread'
    | 'raw-porkchop'
    | 'cooked-porkchop'
    | 'raw-fish'
    | 'cooked-fish'
    | 'wheat',
) {
  if (
    kind === 'apple' ||
    kind === 'bread' ||
    kind === 'raw-porkchop' ||
    kind === 'cooked-porkchop' ||
    kind === 'raw-fish' ||
    kind === 'cooked-fish' ||
    kind === 'wheat'
  )
    return foodSprite(kind satisfies FoodSpriteKind);
  const sprite = new Sprite();
  if (kind === 'diamond') {
    sprite.polygon(
      [
        [10, 5],
        [23, 5],
        [29, 13],
        [16, 28],
        [3, 13],
      ],
      18,
    );
    sprite.polygon(
      [
        [11, 7],
        [21, 7],
        [26, 13],
        [16, 25],
        [6, 13],
      ],
      19,
    );
    sprite.polygon(
      [
        [11, 7],
        [16, 7],
        [10, 13],
        [6, 13],
      ],
      21,
    );
    sprite.polygon(
      [
        [16, 7],
        [21, 7],
        [26, 13],
        [21, 13],
      ],
      20,
    );
    sprite.polygon(
      [
        [11, 14],
        [21, 14],
        [16, 24],
      ],
      20,
    );
  } else if (kind === 'stick') {
    for (let i = 5; i < 26; i++) {
      sprite.rect(i, 30 - i, 4, 4, 2);
      sprite.rect(i, 30 - i, 2, 2, i % 4 === 0 ? 3 : 5);
    }
  } else if (kind === 'iron-ingot' || kind === 'gold-ingot') {
    sprite.polygon(
      [
        [10, 10],
        [24, 10],
        [29, 17],
        [24, 23],
        [3, 23],
        [3, 18],
      ],
      7,
    );
    sprite.polygon(
      [
        [11, 11],
        [23, 11],
        [27, 17],
        [8, 17],
      ],
      10,
    );
    sprite.polygon(
      [
        [8, 18],
        [27, 18],
        [23, 22],
        [4, 22],
      ],
      8,
    );
    sprite.rect(11, 11, 12, 1, 11);
    sprite.rect(7, 17, 19, 1, 11);
    sprite.rect(7, 19, 16, 1, 9);
  } else {
    sprite.polygon(
      [
        [8, 8],
        [19, 6],
        [25, 10],
        [29, 20],
        [23, 26],
        [9, 27],
        [3, 21],
        [4, 14],
      ],
      7,
    );
    sprite.polygon(
      [
        [8, 10],
        [18, 7],
        [23, 11],
        [20, 16],
        [11, 18],
        [5, 15],
      ],
      kind === 'coal' ? 15 : 16,
    );
    sprite.polygon(
      [
        [5, 16],
        [11, 19],
        [10, 25],
        [5, 21],
      ],
      8,
    );
    sprite.polygon(
      [
        [12, 19],
        [20, 17],
        [25, 22],
        [22, 25],
        [12, 26],
      ],
      kind === 'coal' ? 15 : 16,
    );
    sprite.polygon(
      [
        [24, 12],
        [27, 20],
        [24, 22],
        [21, 16],
      ],
      kind === 'coal' ? 8 : 17,
    );
    sprite.rect(9, 11, 3, 1, kind === 'coal' ? 9 : 5);
    if (kind === 'raw-iron') {
      sprite.rect(14, 10, 4, 3, 17);
      sprite.rect(15, 21, 5, 2, 17);
    }
  }
  if (kind === 'gold-ingot') {
    const gold: Record<number, number> = { 7: 12, 8: 13, 9: 14, 10: 14, 11: 6 };
    return sprite.pixels.map((color) => gold[color] ?? color);
  }
  return sprite.pixels;
}

export function pixelItemAssets(
  id: string,
  name: string,
  kind:
    | 'pickaxe'
    | 'axe'
    | 'sword'
    | 'shovel'
    | 'hoe'
    | 'coal'
    | 'raw-iron'
    | 'iron-ingot'
    | 'gold-ingot'
    | 'diamond'
    | 'stick'
    | 'apple'
    | 'bread'
    | 'raw-porkchop'
    | 'cooked-porkchop'
    | 'raw-fish'
    | 'cooked-fish'
    | 'wheat',
  material: 'wood' | 'stone' | 'iron' | 'gold' | 'diamond' = 'wood',
): NativeAsset[] {
  const textureId = `builtin:texture:${id}:detail`;
  return [
    {
      id: textureId,
      name: `${name}像素`,
      source: 'builtin',
      revision: 2,
      type: 'pixel-texture',
      payload: {
        width: 32,
        height: 32,
        palette: palette.map((color) => [...color]),
        pixels:
          kind === 'axe' || kind === 'sword' || kind === 'pickaxe' || kind === 'shovel' || kind === 'hoe'
            ? tool(kind, material)
            : resource(kind),
      },
    },
    {
      id: `builtin:model:${id}`,
      name,
      source: 'builtin',
      revision: 2,
      type: 'extruded-pixel-model',
      payload: {
        textureId,
        pixelsPerUnit: 32,
        thicknessPixels: 4,
        grip: kind === 'sword' ? [15.5, 25] : [15.5, 23],
        generatorVersion: 1,
      },
    },
  ];
}
