/** First-party pixel silhouettes, authored upright around the hand grip; not a resource-pack ABI. */
type ToolModel = Readonly<{
  pixels: readonly string[];
  palette: Readonly<Record<string, readonly [number, number, number]>>;
  grip: readonly [number, number];
}>;

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

const models: Readonly<Record<string, ToolModel>> = {
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

export const toolModelDefinition = (itemId: string): ToolModel | null =>
  Object.hasOwn(models, itemId) ? models[itemId] : null;

/** One mesh per definition. Adjacent cells omit internal faces; front/back retain the pixel palette. */
export function buildToolMesh(definition: ToolModel) {
  const positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  const unit = 1 / 16;
  const occupied = (column: number, row: number) => {
    const pixel = definition.pixels[row]?.[column];
    return pixel !== undefined && pixel !== '.';
  };
  const face = (corners: number[][], normal: number[], color: readonly number[]) => {
    const base = positions.length / 3;
    // StandardMaterial vertex albedo is linear, unlike its sRGB texture input.
    const linearColor = color.map((byte) => {
      const srgb = byte / 255;
      return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    });
    for (const point of corners) {
      positions.push(...point);
      normals.push(...normal);
      colors.push(...linearColor, 1);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  definition.pixels.forEach((row, y) => {
    [...row].forEach((pixel, x) => {
      if (pixel === '.') return;
      const color = definition.palette[pixel];
      if (!color) throw new RangeError(`Missing tool palette entry: ${pixel}`);
      const left = (x - definition.grip[0]) * unit;
      const right = left + unit;
      const top = (definition.grip[1] - y) * unit;
      const bottom = top - unit;
      const front = unit,
        back = -unit;
      face(
        [
          [left, bottom, front],
          [right, bottom, front],
          [right, top, front],
          [left, top, front],
        ],
        [0, 0, 1],
        color,
      );
      face(
        [
          [right, bottom, back],
          [left, bottom, back],
          [left, top, back],
          [right, top, back],
        ],
        [0, 0, -1],
        color,
      );
      if (!occupied(x - 1, y))
        face(
          [
            [left, bottom, back],
            [left, bottom, front],
            [left, top, front],
            [left, top, back],
          ],
          [-1, 0, 0],
          color,
        );
      if (!occupied(x + 1, y))
        face(
          [
            [right, bottom, front],
            [right, bottom, back],
            [right, top, back],
            [right, top, front],
          ],
          [1, 0, 0],
          color,
        );
      if (!occupied(x, y - 1))
        face(
          [
            [left, top, front],
            [right, top, front],
            [right, top, back],
            [left, top, back],
          ],
          [0, 1, 0],
          color,
        );
      if (!occupied(x, y + 1))
        face(
          [
            [left, bottom, back],
            [right, bottom, back],
            [right, bottom, front],
            [left, bottom, front],
          ],
          [0, -1, 0],
          color,
        );
    });
  });
  return { positions, normals, colors, indices };
}
