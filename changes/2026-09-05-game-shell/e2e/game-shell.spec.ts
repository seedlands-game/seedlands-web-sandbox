import { expect, test } from '@playwright/test';
import { lockPointer, snapshot, startHarnessWorld } from '../../../tests/e2e/support/harness';

test('暂停设置、保存退出与继续保持世界', async ({ page }) => {
  await startHarnessWorld(page, 'seedlands-shell-journey');
  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  await expect(page.getByRole('heading', { name: '旅途暂歇' })).toBeVisible();
  const paused = await snapshot(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('音乐音量').focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < 17; i++) await page.keyboard.press('ArrowRight');
  await page.getByLabel('视觉质量设置').selectOption('high');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  expect((await snapshot(page))?.worldTime).toBe(paused?.worldTime);
  await page.getByRole('button', { name: '保存并返回主菜单' }).click();
  await expect(page.getByRole('button', { name: '继续世界', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续世界', exact: true }).click();
  await expect(page.locator('#start-card')).toBeHidden();
  await expect.poll(async () => (await snapshot(page))?.quality).toBe('high');
  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('音乐音量')).toHaveValue('0.17');
});

test('700px 窄屏和减少动态保留菜单设置与指南', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('总音量')).toBeVisible();
  const back = await page.getByRole('button', { name: '返回', exact: true }).boundingBox();
  expect(back!.y + back!.height).toBeLessThanOrEqual(720);
  const panel = await page.getByRole('dialog', { name: '设置' }).boundingBox();
  expect(panel).not.toBeNull();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(700);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '操作指南' }).click();
  await expect(page.getByRole('dialog', { name: '操作指南' })).toContainText('WASD');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('十次保存退出和继续后世界与音频资源仍有界', async ({ page }) => {
  test.setTimeout(90000);
  await startHarnessWorld(page, 'seedlands-shell-lifecycle');
  for (let i = 0; i < 10; i++) {
    const lifecycle = await page.evaluate(() =>
      (
        window as unknown as {
          __seedlandsHarness: { lifecycleSnapshot: () => { worldInstanceId: number; disposedWorlds: number } };
        }
      ).__seedlandsHarness.lifecycleSnapshot(),
    );
    expect(lifecycle.worldInstanceId).toBe(i + 1);
    expect(lifecycle.disposedWorlds).toBe(i);
    await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
    await page.getByRole('button', { name: '保存并返回主菜单' }).click();
    await expect(page.getByRole('button', { name: '继续世界', exact: true })).toBeVisible();
    await expect.poll(() => page.workers().length).toBeLessThanOrEqual(1);
    if (i < 9) {
      await page.getByRole('button', { name: '继续世界', exact: true }).click();
      await expect(page.getByRole('button', { name: '暂停游戏', exact: true })).toBeVisible();
    }
  }
});

test('背包释放鼠标和关闭面板不会被暂停菜单抢占', async ({ page }) => {
  await startHarnessWorld(page, 'seedlands-overlay-ownership');
  await lockPointer(page);
  await page.keyboard.press('KeyE');
  await expect(page.getByRole('dialog', { name: '背包与合成' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '旅途暂歇' })).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '背包与合成' })).toBeHidden();
  await expect(page.getByRole('heading', { name: '旅途暂歇' })).toBeHidden();
});
