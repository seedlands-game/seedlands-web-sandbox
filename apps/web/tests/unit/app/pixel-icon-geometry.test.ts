import { expect, it } from 'vitest';
import { itemIconUrl } from '../../../src/app/gameplay/asset-image';
import { builtinAssets, builtinItemBindings } from '../../../src/client/presentation/asset-catalog';
import type { PixelTexture } from '../../../src/client/presentation/asset-types';

const textures = new Map(builtinAssets.map((asset) => [asset.id, asset]));
const workload = [
  ...new Map(
    builtinItemBindings.flatMap((binding) => {
      const texture = textures.get(binding.iconId);
      return texture?.type === 'pixel-texture' ? [[texture.id, { itemId: binding.itemId, texture }] as const] : [];
    }),
  ).values(),
];

function svgFor(itemId: string) {
  const url = itemIconUrl(itemId, '/');
  expect(url.startsWith('data:image/svg+xml,')).toBe(true);
  return { url, svg: decodeURIComponent(url.slice('data:image/svg+xml,'.length)) };
}

function pixelsFromSvg(svg: string, texture: PixelTexture) {
  const { width, height } = texture.payload;
  const pixels: Array<string | null> = Array(width * height).fill(null);
  const put = (x: number, y: number, rgb: string) => {
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(width);
    expect(y).toBeLessThan(height);
    expect(pixels[y * width + x]).toBeNull();
    pixels[y * width + x] = rgb;
  };
  for (const match of svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="1" fill="rgb\(([^)]+)\)"\/>/g)) {
    for (let offset = 0; offset < Number(match[3]); offset++)
      put(Number(match[1]) + offset, Number(match[2]), match[4]!);
  }
  for (const match of svg.matchAll(/<path d="([^"]+)" fill="rgb\(([^)]+)\)"\/>/g)) {
    const commands = [...match[1]!.matchAll(/M(\d+) (\d+)h1v1h-1z/g)];
    expect(commands.map((command) => command[0]).join('')).toBe(match[1]);
    for (const command of commands) put(Number(command[1]), Number(command[2]), match[2]!);
  }
  return pixels;
}

it('preserves every builtin pixel icon cell, transparency, coordinates and cached URL', () => {
  expect(workload.length).toBeGreaterThan(100);
  for (const { itemId, texture } of workload) {
    const first = svgFor(itemId);
    expect(first.svg).toContain(`viewBox="0 0 ${texture.payload.width} ${texture.payload.height}"`);
    expect(first.svg).toContain('shape-rendering="crispEdges"');
    expect(svgFor(itemId)).toEqual(first);
    const expected = texture.payload.pixels.map((index) =>
      index === 0 ? null : texture.payload.palette[index]!.join(','),
    );
    expect(pixelsFromSvg(first.svg, texture), itemId).toEqual(expected);
  }
});

it('bounds the SVG element graph by same-color row segments on the fixed builtin workload', () => {
  const collect = () =>
    workload.reduce(
      (total, { itemId, texture }) => {
        const { url, svg } = svgFor(itemId);
        const colors = new Set(
          texture.payload.pixels
            .filter((index) => index !== 0)
            .map((index) => texture.payload.palette[index]!.join(',')),
        );
        const { pixels, palette, width } = texture.payload;
        const runBound = pixels.reduce(
          (count, color, index) =>
            count +
            Number(
              color !== 0 &&
                (index % width === 0 ||
                  pixels[index - 1] === 0 ||
                  palette[color]!.join(',') !== palette[pixels[index - 1]!]!.join(',')),
            ),
          0,
        );
        return {
          icons: total.icons + 1,
          elements: total.elements + [...svg.matchAll(/<(?:rect|path)\b/g)].length,
          colorBound: total.colorBound + colors.size,
          runBound: total.runBound + runBound,
          opaquePixels: total.opaquePixels + texture.payload.pixels.filter((index) => index !== 0).length,
          urlBytes: total.urlBytes + new TextEncoder().encode(url).byteLength,
        };
      },
      { icons: 0, elements: 0, colorBound: 0, runBound: 0, opaquePixels: 0, urlBytes: 0 },
    );
  const first = collect();
  const repeat = collect();
  console.info('pixel-icon-geometry-budget', JSON.stringify({ first, repeat }));
  expect(repeat).toEqual(first);
  expect(first.elements).toBe(first.runBound);
  expect(first.elements).toBeLessThan(first.opaquePixels);
});
