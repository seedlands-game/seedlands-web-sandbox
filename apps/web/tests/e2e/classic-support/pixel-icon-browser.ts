import { expect, type Page, type TestInfo } from '@playwright/test';
import { builtinAssets, builtinItemBindings } from '../../../src/client/presentation/asset-catalog';

/** Raster correctness for the actual catalog consumer; not a frame-cost measurement. */
export async function verifyPixelIconRaster(page: Page, info: TestInfo) {
  const assets = new Map(builtinAssets.map((asset) => [asset.id, asset]));
  const controls = Object.fromEntries(
    builtinItemBindings.flatMap((binding) => {
      const asset = assets.get(binding.iconId);
      if (asset?.type !== 'pixel-texture') return [];
      const { width, height, pixels, palette } = asset.payload;
      // Frozen reference shape: the original one-rect-per-opaque-pixel presentation.
      const rectangles = pixels
        .flatMap((color, index) =>
          color === 0
            ? []
            : [
                `<rect x="${index % width}" y="${Math.floor(index / width)}" width="1" height="1" fill="rgb(${palette[color]!.join(',')})"/>`,
              ],
        )
        .join('');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${rectangles}</svg>`;
      const colorCount = new Set(pixels.filter((color) => color !== 0).map((color) => palette[color]!.join(','))).size;
      const shapeBound = pixels.reduce(
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
      return [[binding.itemId, { url: `data:image/svg+xml,${encodeURIComponent(svg)}`, colorCount, shapeBound }]];
    }),
  );
  const result = await page.evaluate(async (references) => {
    const rows: Array<{
      itemId: string;
      size: number;
      differentChannels: number;
      sourceAADifferentChannels: number;
      equalContextDifferentChannels: number;
      actualSha256: string;
      freshActualSha256: string;
      controlSha256: string;
      elements: number;
      colorCount: number;
      shapeBound: number;
    }> = [];
    const skipped: Array<{ itemId: string; reason: string }> = [];
    const errors: string[] = [];
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Pixel icon raster needs Canvas2D.');
    const hash = async (bytes: Uint8ClampedArray) =>
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)), (value) =>
        value.toString(16).padStart(2, '0'),
      ).join('');
    for (const button of Array.from(
      document.querySelectorAll<HTMLButtonElement>('#creative-catalog button[data-item]'),
    )) {
      const itemId = button.dataset.item!;
      const reference = references[itemId];
      if (!reference) continue;
      const image = button.querySelector<HTMLImageElement>('.item-icon');
      if (!image) {
        errors.push(`${itemId}: missing production image`);
        continue;
      }
      if (!image.src.startsWith('data:image/svg+xml,')) {
        skipped.push({ itemId, reason: 'Pack/appearance image override; outside pixel-SVG axis' });
        continue;
      }
      try {
        await image.decode();
        const control = new Image();
        control.src = reference.url;
        await control.decode();
        const freshActual = new Image();
        freshActual.src = image.src;
        await freshActual.decode();
        const svg = decodeURIComponent(image.src.slice('data:image/svg+xml,'.length));
        const elements = [...svg.matchAll(/<(?:rect|path)\b/g)].length;
        if (elements !== reference.shapeBound)
          errors.push(`${itemId}: ${elements} elements, expected ${reference.shapeBound}`);
        for (const size of [16, 32]) {
          canvas.width = canvas.height = size;
          context.imageSmoothingEnabled = false;
          context.drawImage(control, 0, 0, size, size);
          const before = context.getImageData(0, 0, size, size).data;
          context.clearRect(0, 0, size, size);
          context.drawImage(image, 0, 0, size, size);
          const after = context.getImageData(0, 0, size, size).data;
          const differentChannels = after.reduce((count, value, index) => count + Number(value !== before[index]), 0);
          context.clearRect(0, 0, size, size);
          context.drawImage(freshActual, 0, 0, size, size);
          const fresh = context.getImageData(0, 0, size, size).data;
          const sourceAADifferentChannels = fresh.reduce(
            (count, value, index) => count + Number(value !== after[index]),
            0,
          );
          const equalContextDifferentChannels = fresh.reduce(
            (count, value, index) => count + Number(value !== before[index]),
            0,
          );
          rows.push({
            itemId,
            size,
            differentChannels,
            sourceAADifferentChannels,
            equalContextDifferentChannels,
            elements,
            colorCount: reference.colorCount,
            shapeBound: reference.shapeBound,
            actualSha256: await hash(after),
            freshActualSha256: await hash(fresh),
            controlSha256: await hash(before),
          });
          if (differentChannels) errors.push(`${itemId}@${size}: ${differentChannels} different RGBA channels`);
          if (sourceAADifferentChannels)
            errors.push(`${itemId}@${size}: same-source contexts differ by ${sourceAADifferentChannels} channels`);
        }
      } catch (error) {
        errors.push(`${itemId}: ${String(error)}`);
      }
    }
    return { rows, skipped, errors };
  }, controls);
  await info.attach('pixel-icon-browser-equivalence.json', {
    contentType: 'application/json',
    body: JSON.stringify({
      runId: process.env.SEEDLANDS_HARNESS_RUN_ID,
      sourceSha: process.env.SEEDLANDS_SOURCE_SHA,
      diagnosticOnly: true,
      performanceEligible: false,
      renderer: 'Chromium SVG/Canvas2D',
      ...result,
    }),
  });
  expect(result.errors).toEqual([]);
  expect(new Set(result.rows.map((row) => row.itemId)).size).toBeGreaterThan(100);
}
