import type { ToolModel } from './asset-types';
import { nativeToolAssets } from './asset-tool-sources';
import { resolvePixelModel } from './asset-package';

const definitions = new Map(
  nativeToolAssets
    .filter((a) => a.type === 'extruded-pixel-model')
    .map((a) => [a.id.replace('builtin:model:', ''), resolvePixelModel(a, nativeToolAssets)]),
);
export const toolModelDefinition = (itemId: string): ToolModel | null => definitions.get(itemId) ?? null;

/** One mesh per definition. Adjacent cells omit internal faces; front/back retain the pixel palette. */
export function buildToolMesh(definition: ToolModel) {
  const positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  const unit = 1 / (definition.pixelsPerUnit ?? 16);
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
  // Merge only coplanar, identically colored front/back runs. Side silhouettes stay exact.
  definition.pixels.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const pixel = row[x];
      if (pixel === '.') {
        x++;
        continue;
      }
      const color = definition.palette[pixel];
      if (!color) throw new RangeError(`Missing tool palette entry: ${pixel}`);
      let end = x + 1;
      while (end < row.length && row[end] === pixel) end++;
      const left = (x - definition.grip[0]) * unit;
      const right = (end - definition.grip[0]) * unit;
      const top = (definition.grip[1] - y) * unit;
      const bottom = top - unit;
      const front = ((definition.thicknessPixels ?? 2) * unit) / 2,
        back = -front;
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
      x = end;
    }
  });
  definition.pixels.forEach((row, y) => {
    [...row].forEach((pixel, x) => {
      if (pixel === '.') return;
      const color = definition.palette[pixel];
      if (!color) throw new RangeError(`Missing tool palette entry: ${pixel}`);
      const left = (x - definition.grip[0]) * unit;
      const right = left + unit;
      const top = (definition.grip[1] - y) * unit;
      const bottom = top - unit;
      const front = ((definition.thicknessPixels ?? 2) * unit) / 2,
        back = -front;
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
