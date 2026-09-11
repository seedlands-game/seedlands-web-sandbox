import { expect, type Locator } from '@playwright/test';

/** Measure the visible silhouette after object-fit, independently of text overlays. */
export async function expectCenteredItemIcons(images: Locator) {
  expect(await images.count()).toBeGreaterThan(0);
  for (const image of await images.all()) {
    await expect
      .poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
      .toBe(true);
  }
  const measurements = await images.evaluateAll((nodes) =>
    nodes.map((node) => {
      const image = node as HTMLImageElement;
      const box = image.getBoundingClientRect();
      const slot = image
        .closest('[data-slot], [data-station-slot], [data-craft-result], .game-slot')!
        .getBoundingClientRect();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let left = canvas.width,
        right = -1,
        top = canvas.height,
        bottom = -1;
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++) {
          if (pixels[(y * canvas.width + x) * 4 + 3] < 128) continue;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      const scale = Math.min(box.width / canvas.width, box.height / canvas.height);
      return {
        item: image.closest('[data-item]')?.getAttribute('data-item'),
        visible: right >= left && bottom >= top,
        offsetX:
          box.x + box.width / 2 + ((left + right + 1) / 2 - canvas.width / 2) * scale - (slot.x + slot.width / 2),
        offsetY:
          box.y + box.height / 2 + ((top + bottom + 1) / 2 - canvas.height / 2) * scale - (slot.y + slot.height / 2),
      };
    }),
  );
  for (const measurement of measurements) {
    expect(measurement.visible, JSON.stringify(measurement)).toBe(true);
    expect(Math.abs(measurement.offsetX), JSON.stringify(measurement)).toBeLessThanOrEqual(1);
    expect(Math.abs(measurement.offsetY), JSON.stringify(measurement)).toBeLessThanOrEqual(1);
  }
  return measurements;
}
