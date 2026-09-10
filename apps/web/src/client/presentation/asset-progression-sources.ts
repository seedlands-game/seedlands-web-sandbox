import type { NativeAsset, Rgb } from './asset-types';

const pickaxe = [
  '................',
  '....ooooooo.....',
  '...ohhhhhhoo....',
  '..ohhhhhhhhho...',
  '.ohhoooooohhho..',
  '.oho..ww..ohho..',
  '.oo...ww...oho..',
  '......ww....oo..',
  '......ww........',
  '......ww........',
  '......ww........',
  '......ww........',
  '......ww........',
  '......ww........',
  '......oo........',
  '................',
];
const lump = [
  '................',
  '................',
  '................',
  '......oooo......',
  '....oohhhhoo....',
  '...ohhhhhhhho...',
  '..ohhbhhhhhbho..',
  '..ohhhhhhhhho...',
  '..ohhhbhhhhho...',
  '...ohhhhhhho....',
  '....ooooooo.....',
  '................',
  '................',
  '................',
  '................',
  '................',
];
const ingot = [
  '................',
  '................',
  '................',
  '................',
  '.....ooooooo....',
  '....ohhhhhhho...',
  '...ohhhhhhhhho..',
  '..oooooooooooo..',
  '..obbbbbbbbbo...',
  '..obbbbbbbbo....',
  '...oooooooo.....',
  '................',
  '................',
  '................',
  '................',
  '................',
];
const block = [
  '................',
  '................',
  '...oooooooooo...',
  '..ohhhhhhhhoo...',
  '..ohhhhhhhhoo...',
  '..ohhhhhhhhoo...',
  '..ooooooooooo...',
  '..obbbobbbboo...',
  '..obbbobbbboo...',
  '..obbbobbbboo...',
  '..obbbobbbboo...',
  '..obbbobbbboo...',
  '..ooooooooooo...',
  '................',
  '................',
  '................',
];
const definitions = [
  { id: 'wood-pickaxe', name: '木镐', pixels: pickaxe, head: [176, 116, 57], body: [114, 68, 34], model: true },
  { id: 'iron-pickaxe', name: '铁镐', pixels: pickaxe, head: [211, 224, 223], body: [113, 145, 151], model: true },
  { id: 'coal', name: '煤', pixels: lump, head: [48, 55, 61], body: [77, 87, 94], model: true },
  { id: 'raw-iron', name: '粗铁', pixels: lump, head: [176, 120, 91], body: [232, 180, 134], model: true },
  { id: 'iron-ingot', name: '铁锭', pixels: ingot, head: [220, 229, 227], body: [137, 159, 167], model: true },
  { id: 'workbench', name: '工作台', pixels: block, head: [194, 135, 67], body: [122, 78, 42], model: false },
  { id: 'chest', name: '箱子', pixels: block, head: [147, 94, 41], body: [205, 154, 62], model: false },
  { id: 'furnace', name: '炉体', pixels: block, head: [126, 137, 141], body: [56, 65, 70], model: false },
] as const;

/** First-party pixels share the existing icon and extruded-item asset pipeline. */
export const progressionItemAssets: NativeAsset[] = definitions.flatMap((source): NativeAsset[] => {
  const symbols = '.ohbw',
    textureId = `builtin:texture:${source.id}`;
  const palette: Rgb[] = [[0, 0, 0], [32, 34, 36], [...source.head], [...source.body], [134, 87, 46]];
  return [
    {
      id: textureId,
      name: `${source.name}图标`,
      source: 'builtin',
      revision: 1,
      type: 'pixel-texture',
      payload: {
        width: 16,
        height: 16,
        palette,
        pixels: source.pixels.flatMap((row) => [...row].map((value) => symbols.indexOf(value))),
      },
    },
    ...(source.model
      ? [
          {
            id: `builtin:model:${source.id}`,
            name: source.name,
            source: 'builtin' as const,
            revision: 1,
            type: 'extruded-pixel-model' as const,
            payload: {
              textureId,
              thicknessPixels: 2,
              grip: [7.5, 11.5] as [number, number],
              generatorVersion: 1 as const,
            },
          },
        ]
      : []),
  ];
});
