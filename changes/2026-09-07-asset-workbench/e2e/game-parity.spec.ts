import { expect, test } from '@playwright/test';
import { startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test('游戏手持网格与工坊同源，快捷栏已使用新像素图标', async ({ page }, testInfo) => {
  await startHarnessWorld(page, 'mosslight-68');
  await waitForSnapshot(page, (s) => s.onGround && !s.colliding);
  await page.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    await h.executeGameplayCommand({ type: 'give-item', itemId: 'stone-pickaxe', count: 1 });
    await h.setWorldTime(10);
    h.setTimePaused(true);
  });
  await page.keyboard.press('KeyE');
  const slot = page.getByRole('gridcell', { name: '石镐 1', exact: true });
  const index = Number(await slot.getAttribute('data-slot'));
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await page.keyboard.press(`Digit${index + 1}`);
  const match = () =>
    page.evaluate(async () => {
      const path = '/changes/2026-09-07-asset-workbench/e2e/probes.ts';
      return ((await import(path)) as typeof import('./probes')).heldMatchesSource('stone-pickaxe');
    });
  await expect.poll(match).toBe(true);
  const icon = page.locator('.item-icon[src^="data:image/png"]:visible').first();
  await expect(icon).toBeVisible();
  const image = await icon.evaluate(async (element) => {
    const img = element as HTMLImageElement;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(img, 0, 0);
    return {
      width: canvas.width,
      height: canvas.height,
      rgba: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data),
    };
  });
  expect(image.width).toBe(16);
  expect(image.height).toBe(16);
  const expected = await page.evaluate(async () => {
    const path = '/src/client/presentation/asset-catalog.ts';
    const catalog = (await import(path)) as typeof import('../../../src/client/presentation/asset-catalog');
    const texture = catalog.builtinAssets.find((a) => a.id === 'builtin:texture:stone-pickaxe')!;
    if (texture.type !== 'pixel-texture') throw Error('missing source');
    return texture.payload.pixels.flatMap((i) => (i === 0 ? [0, 0, 0, 0] : [...texture.payload.palette[i], 255]));
  });
  expect(image.rgba).toEqual(expected);
  await page.keyboard.press('F3');
  await page.screenshot({ path: testInfo.outputPath('game-tool-and-icon.png') });
});
