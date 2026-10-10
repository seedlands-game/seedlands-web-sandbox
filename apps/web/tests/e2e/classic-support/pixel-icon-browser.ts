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
      const shapeBound = colorCount;
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
      equivalentResourceDifferentChannels: number;
      sourceIdentityMatchesControl: boolean;
      controlRepeatDifferentChannels: number;
      domRepeatDifferentChannels: number;
      rawRaster?: { control: number[]; actual: number[]; controlRepeat: number[] };
      domImage: { width: number; height: number; naturalWidth: number; naturalHeight: number; imageRendering: string };
      freshImage: {
        width: number;
        height: number;
        naturalWidth: number;
        naturalHeight: number;
        imageRendering: string;
      };
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
    const context = canvas.getContext('2d', { willReadFrequently: true });
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
        // Keep image dimensions and style equal so the comparison varies only SVG geometry.
        const matchingImage = () => {
          const value = new Image(image.width, image.height);
          value.style.imageRendering = getComputedStyle(image).imageRendering;
          return value;
        };
        const control = matchingImage();
        control.src = reference.url;
        await control.decode();
        const freshActual = matchingImage();
        freshActual.src = image.src;
        await freshActual.decode();
        // Same old geometry; different resource URL prevents reuse of the DOM-seeded resource.
        const equivalentControl = matchingImage();
        equivalentControl.src = `${reference.url}%0A`;
        await equivalentControl.decode();
        const svg = decodeURIComponent(image.src.slice('data:image/svg+xml,'.length));
        const elements = [...svg.matchAll(/<(?:rect|path)\b/g)].length;
        if (elements !== reference.shapeBound)
          errors.push(`${itemId}: ${elements} elements, expected ${reference.shapeBound}`);
        for (const size of new Set([16, 32, image.width])) {
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
          context.clearRect(0, 0, size, size);
          context.drawImage(equivalentControl, 0, 0, size, size);
          const equivalent = context.getImageData(0, 0, size, size).data;
          const equivalentResourceDifferentChannels = equivalent.reduce(
            (count, value, index) => count + Number(value !== after[index]),
            0,
          );
          context.clearRect(0, 0, size, size);
          context.drawImage(control, 0, 0, size, size);
          const controlRepeat = context.getImageData(0, 0, size, size).data;
          const controlRepeatDifferentChannels = controlRepeat.reduce(
            (count, value, index) => count + Number(value !== before[index]),
            0,
          );
          context.clearRect(0, 0, size, size);
          context.drawImage(image, 0, 0, size, size);
          const domRepeat = context.getImageData(0, 0, size, size).data;
          const domRepeatDifferentChannels = domRepeat.reduce(
            (count, value, index) => count + Number(value !== after[index]),
            0,
          );
          rows.push({
            itemId,
            size,
            differentChannels,
            sourceAADifferentChannels,
            equalContextDifferentChannels,
            equivalentResourceDifferentChannels,
            sourceIdentityMatchesControl: image.src === reference.url,
            controlRepeatDifferentChannels,
            domRepeatDifferentChannels,
            ...(size === 16 && (itemId === 'paper' || itemId === 'redstone-dust')
              ? {
                  rawRaster: {
                    control: Array.from(before),
                    actual: Array.from(after),
                    controlRepeat: Array.from(controlRepeat),
                  },
                }
              : {}),
            domImage: {
              width: image.width,
              height: image.height,
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
              imageRendering: getComputedStyle(image).imageRendering,
            },
            freshImage: {
              width: freshActual.width,
              height: freshActual.height,
              naturalWidth: freshActual.naturalWidth,
              naturalHeight: freshActual.naturalHeight,
              imageRendering: freshActual.style.imageRendering,
            },
            elements,
            colorCount: reference.colorCount,
            shapeBound: reference.shapeBound,
            actualSha256: await hash(after),
            freshActualSha256: await hash(fresh),
            controlSha256: await hash(before),
          });
          if (differentChannels) errors.push(`${itemId}@${size}: ${differentChannels} different RGBA channels`);
          if (controlRepeatDifferentChannels)
            errors.push(
              `${itemId}@${size}: same control object repeat differs by ${controlRepeatDifferentChannels} channels`,
            );
          if (domRepeatDifferentChannels)
            errors.push(`${itemId}@${size}: same DOM object repeat differs by ${domRepeatDifferentChannels} channels`);
          if (equivalentResourceDifferentChannels)
            errors.push(
              `${itemId}@${size}: equivalent resource differs by ${equivalentResourceDifferentChannels} channels`,
            );
          if (sourceAADifferentChannels)
            errors.push(`${itemId}@${size}: same-source contexts differ by ${sourceAADifferentChannels} channels`);
        }
      } catch (error) {
        errors.push(`${itemId}: ${String(error)}`);
      }
    }
    return { rows, skipped, errors, canvasAttributes: context.getContextAttributes() };
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
