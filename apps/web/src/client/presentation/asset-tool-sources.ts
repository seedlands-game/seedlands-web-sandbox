import type { NativeAsset, Rgb } from './asset-types';

const palette = {
  o: [57, 37, 28],
  h: [125, 77, 40],
  l: [191, 132, 67],
  w: [155, 99, 46],
  e: [225, 169, 86],
  d: [46, 60, 66],
  s: [105, 129, 135],
  b: [170, 193, 187],
  t: [57, 103, 103],
} as const;

const sources = {
  'wood-axe': {
    palette,
    grip: [7.5, 11.5],
    pixels: [
      '................',
      '.......oooo.....',
      '......oleeeo....',
      '......olwweeo...',
      '......ohlwweeo..',
      '......ohwwweeo..',
      '......otwwweeo..',
      '......otoweeo...',
      '......oh.ooo....',
      '......ohlo......',
      '......ohlo......',
      '......ohlo......',
      '......ohlo......',
      '......ohlo......',
      '......oooo......',
      '................',
    ],
  },
  'stone-pickaxe': {
    palette,
    grip: [7.5, 11.5],
    pixels: [
      '................',
      '....ddddddd.....',
      '...dbbbbbbdd....',
      '..dbsssssssbd...',
      '.dbsddttddssbd..',
      '.dsd..tt..dssd..',
      '.dd...oh...dsd..',
      '......oh....dd..',
      '......hl........',
      '......hl........',
      '......hl........',
      '......hl........',
      '......hl........',
      '......hl........',
      '......oo........',
      '................',
    ],
  },
};

export const nativeToolAssets: NativeAsset[] = Object.entries(sources).flatMap(([itemId, model]) => {
  const colors = Object.keys(model.palette);
  const textureId = `builtin:texture:${itemId}`;
  return [
    {
      id: textureId,
      name: itemId === 'wood-axe' ? '木斧像素' : '石镐像素',
      source: 'builtin',
      revision: 1,
      type: 'pixel-texture',
      payload: {
        width: 16,
        height: 16,
        palette: [[0, 0, 0], ...Object.values(model.palette).map((c) => [...c] as Rgb)],
        pixels: model.pixels.flatMap((row) => [...row].map((c) => (c === '.' ? 0 : colors.indexOf(c) + 1))),
      },
    },
    {
      id: `builtin:model:${itemId}`,
      name: itemId === 'wood-axe' ? '木斧' : '石镐',
      source: 'builtin',
      revision: 1,
      type: 'extruded-pixel-model',
      payload: { textureId, thicknessPixels: 2, grip: [7.5, 11.5], generatorVersion: 1 },
    },
  ];
});
