import { expect, test } from '@playwright/test';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { waitForSnapshot } from '../../../tests/e2e/support/harness';

test('Low 午夜与700px减少动态的最终原始画面', async ({ page }, testInfo) => {
  await page.goto('./?harness=1');
  await page.locator('#quality').selectOption('low');
  await page.locator('#seed').fill('living-world-autonomy');
  await page.getByRole('button', { name: '进入世界', exact: true }).click();
  const initial = await waitForSnapshot(page, (s) => s.onGround && !s.colliding);
  const y = Math.floor(initial.player[1] - 1.6);
  await page.evaluate((y) => {
    const h = window.__seedlandsHarness!;
    h.setVoxelAt(6, y, 4, 9);
    h.setSpectatorPosition(3, y + 2.7, 9);
    h.setView(-45, -14);
    h.setWorldTime(0);
    h.setTimePaused(true);
  }, y);
  const ready = await waitForSnapshot(
    page,
    (s) => s.generationQueue === 0 && s.meshingQueue === 0 && s.visualEffects.activeLocalLights === 1,
  );
  expect(ready.visualEffects).toMatchObject({
    reflectionEnabled: false,
    postProcessing: false,
    sunShadows: false,
    shadowedLocalLights: 0,
  });
  await expect(page.locator('#world-clock')).toContainText('0:00');
  await page.keyboard.press('F3');
  await page.screenshot({ path: testInfo.outputPath('low-night.png') });
  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  await page.getByRole('button', { name: '保存并返回主菜单' }).click();
  await page.setViewportSize({ width: 700, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('总音量')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('narrow-settings.png') });
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '操作指南', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '操作指南' })).toContainText('WASD');
  await page.screenshot({ path: testInfo.outputPath('narrow-guide.png') });
  const destination = process.env.SEEDLANDS_PRESENTATION_FRAME_DIR;
  if (destination) {
    mkdirSync(destination, { recursive: true });
    for (const name of ['low-night', 'narrow-settings', 'narrow-guide'])
      copyFileSync(testInfo.outputPath(`${name}.png`), join(destination, `${name}.png`));
    writeFileSync(
      join(destination, 'presentation.html'),
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>最终降级与窄屏画面</title><style>body{margin:24px;background:#11191d;color:#f3e8ce;font:18px system-ui}img{max-width:100%}section{display:flex;gap:16px}figure{margin:0}section img{width:650px}</style><h1>Low · 午夜</h1><img src="low-night.png"><h1>700px · 减少动态</h1><section><figure><figcaption>设置</figcaption><img src="narrow-settings.png"></figure><figure><figcaption>操作指南</figcaption><img src="narrow-guide.png"></figure></section></html>',
    );
  }
});
