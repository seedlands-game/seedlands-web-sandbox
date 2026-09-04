import { expect, test, firefox, webkit } from '@playwright/test';
import { startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

for (const [name, engine] of [
  ['Firefox', firefox],
  ['WebKit', webkit],
] as const) {
  test(`${name} 启动、背包、设置与正式保存继续`, async ({ baseURL }, testInfo) => {
    test.skip(process.env.SEEDLANDS_COMPATIBILITY_ACCEPTANCE !== '1', '兼容性引擎须显式安装并执行。');
    test.setTimeout(90_000);
    const browser = await engine.launch({ headless: true });
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /shader|webgl|framebuffer/i.test(message.text())) errors.push(message.text());
    });
    try {
      await startHarnessWorld(page, 'living-world-autonomy');
      const ready = await waitForSnapshot(page, (s) => s.renderedChunks > 4 && s.onGround && !s.colliding);
      await page.keyboard.press('KeyE');
      await expect(page.getByRole('dialog', { name: '背包与合成' })).toBeVisible();
      await page.getByRole('button', { name: '关闭背包' }).click();
      await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await expect(page.getByLabel('总音量')).toBeVisible();
      await page.getByRole('button', { name: '返回', exact: true }).click();
      await page.getByRole('button', { name: '保存并返回主菜单' }).click();
      await page.getByRole('button', { name: '继续世界', exact: true }).click();
      const restored = await waitForSnapshot(page, (s) => s.onGround && !s.colliding);
      expect(restored.player[0]).toBeCloseTo(ready.player[0], 1);
      await page.screenshot({ path: testInfo.outputPath(`${name.toLowerCase()}-world.png`) });
      await testInfo.attach('browser-environment', {
        body: JSON.stringify({ name, version: browser.version(), ready, restored, errors }),
        contentType: 'application/json',
      });
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
}
