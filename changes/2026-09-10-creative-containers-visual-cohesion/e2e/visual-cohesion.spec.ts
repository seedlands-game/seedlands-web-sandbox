import { expect, test } from '@playwright/test';
import { expectCenteredItemIcons } from '../../../tests/e2e/support/item-icon-centering';
import { writeFile } from 'node:fs/promises';
import { startHarnessWorld, lockPointer, setHarnessView } from '../../../tests/e2e/support/harness';

const items = [
  'wood-pickaxe',
  'stone-pickaxe',
  'iron-pickaxe',
  'wood-axe',
  'wood-sword',
  'workbench',
  'chest',
  'furnace',
  'coal',
  'raw-iron',
  'iron-ingot',
  'dirt-block',
  'stone-block',
  'wood-block',
  'sand-block',
  'berry',
  'plank',
  'glowstone-block',
  'lantern',
];

test('工具和工位在实际背包与持物中清晰显示', async ({ page }, info) => {
  test.setTimeout(120_000);
  await startHarnessWorld(page, 'visual-cohesion', '', 'high');
  await page.evaluate(async (items) => {
    const h = window.__seedlandsHarness!;
    const logic = await h.world.logic({ kind: 'mode', mode: 'scripted' });
    if (!logic.ok) throw new Error('Fixture logic mode failed');
    for (const itemId of items) {
      const result = await h.world.command({ type: 'give-item', itemId, count: 1 });
      if (!result.ok || !result.data.success) throw new Error(`Fixture item failed: ${itemId}`);
    }
  }, items);
  await page.keyboard.press('F3');
  await page.keyboard.press('KeyE');
  for (const id of items) {
    const icon = page.locator(`#inventory-crafting [data-slot][data-item="${id}"] img`);
    await expect(icon).toBeVisible();
    await expect
      .poll(() => icon.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0))
      .toBe(true);
  }
  const centers = [];
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 720, height: 960 },
  ]) {
    await page.setViewportSize(viewport);
    centers.push({
      viewport,
      inventory: await expectCenteredItemIcons(page.locator('#inventory-crafting [data-slot] img')),
      hotbar: await expectCenteredItemIcons(page.locator('#hotbar .game-slot img')),
    });
  }
  await writeFile(info.outputPath('icon-centers.json'), JSON.stringify(centers, null, 2));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: info.outputPath('inventory-assets.png') });
  const dimensions = await page.locator('#inventory-crafting [data-slot] img').evaluateAll((images) =>
    images.map((element) => {
      const image = element as HTMLImageElement;
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let left = canvas.width,
        top = canvas.height,
        right = -1,
        bottom = -1;
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++) {
          if (pixels[(y * canvas.width + x) * 4 + 3] < 128) continue;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      return {
        item: image.closest('[data-item]')?.getAttribute('data-item'),
        width: image.naturalWidth,
        imageBox: image.getBoundingClientRect().width,
        slotHeight: image.closest('[data-slot]')!.getBoundingClientRect().height,
        cornerAlpha: pixels[3],
        extent: Math.max(right - left + 1, bottom - top + 1) / canvas.width,
        inside: left > 0 && top > 0 && right < canvas.width - 1 && bottom < canvas.height - 1,
      };
    }),
  );
  await writeFile(info.outputPath('icon-dimensions.json'), JSON.stringify(dimensions, null, 2));
  await info.attach('icon-dimensions', { body: JSON.stringify(dimensions), contentType: 'application/json' });
  // Every first-party icon must use the same rendered-model thumbnail route.
  await page.keyboard.press('KeyE');
  await lockPointer(page);
  await setHarnessView(page, 0, -12);
  for (const id of items.slice(0, 8)) {
    const key = await page.locator(`#hotbar [data-item="${id}"] .slot-key`).textContent();
    expect(key).toBeTruthy();
    await page.keyboard.press(`Digit${key}`);
    await expect(page.locator(`#hotbar [data-item="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: info.outputPath(`held-${id}.png`) });
  }
  for (const viewport of [
    { width: 720, height: 960 },
    { width: 1920, height: 810 },
  ]) {
    await page.setViewportSize(viewport);
    for (const id of items.slice(0, 5)) {
      const key = await page.locator(`#hotbar [data-item="${id}"] .slot-key`).textContent();
      expect(key).toBeTruthy();
      await page.keyboard.press(`Digit${key}`);
      await expect(page.locator(`#hotbar [data-item="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      );
      await page.screenshot({ path: info.outputPath(`held-${id}-${viewport.width}.png`) });
    }
  }
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 720, height: 960 },
    { width: 1920, height: 810 },
  ]) {
    await page.setViewportSize(viewport);
    await lockPointer(page);
    expect(await page.evaluate(() => window.__seedlandsHarness!.world.clock({ kind: 'pause' }))).toMatchObject({
      ok: true,
    });
    expect(
      await page.evaluate(async (width) => {
        const h = window.__seedlandsHarness!;
        await h.world.command({ type: 'fill', from: [-3, 56, -4], to: [3, 56, 3], voxel: 3 });
        await h.world.command({ type: 'fill', from: [-3, 57, -4], to: [3, 62, 3], voxel: 0 });
        await h.world.command({ type: 'teleport', position: [0.5, 57, 0.5] });
        return h.world.command({ type: 'spawn-creature', id: `visual-target-${width}`, position: [0.5, 57, -1.9] });
      }, viewport.width),
    ).toMatchObject({ ok: true });
    await setHarnessView(page, 0, -15);
    await page.mouse.down();
    await expect(page.locator('#combat-status')).toHaveAttribute('data-phase', 'windup');
    await page.mouse.up();
    for (const [phase, elapsedMs] of [
      ['windup', 100],
      ['hit', 100],
      ['recovery', 120],
    ] as const) {
      expect(
        await page.evaluate(
          (elapsedMs) => window.__seedlandsHarness!.world.clock({ kind: 'advance', elapsedMs }),
          elapsedMs,
        ),
      ).toMatchObject({ ok: true });
      await expect(page.locator('#combat-status')).toHaveAttribute('data-phase', phase);
      await page.screenshot({ path: info.outputPath(`sword-${phase}-${viewport.width}.png`) });
    }
    expect(
      await page.evaluate(() => window.__seedlandsHarness!.world.clock({ kind: 'advance', elapsedMs: 400 })),
    ).toMatchObject({ ok: true });
    expect(await page.evaluate(() => window.__seedlandsHarness!.world.clock({ kind: 'run' }))).toMatchObject({
      ok: true,
    });
  }
  expect(dimensions.every((image) => image.width >= 128)).toBe(true);
  expect(dimensions.every((image) => image.cornerAlpha === 0 && image.inside)).toBe(true);
  for (const image of dimensions) {
    expect(image.extent, JSON.stringify(image)).toBeGreaterThanOrEqual(0.83);
    expect(image.extent, JSON.stringify(image)).toBeLessThanOrEqual(0.94);
    expect((image.imageBox * image.extent) / image.slotHeight, JSON.stringify(image)).toBeGreaterThanOrEqual(0.65);
  }
});
