import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { moveHarnessPlayer, setHarnessView, startHarnessWorld } from '../../../tests/e2e/support/harness';

async function runDebugCommand(page: Page, command: string) {
  await page.keyboard.press('F4');
  const shell = page.getByRole('dialog', { name: '服务端调试命令' });
  const input = shell.getByRole('textbox', { name: '命令' });
  await input.fill(command);
  await input.press('Enter');
  await expect(shell.getByRole('status')).toContainText('成功');
  await input.press('Escape');
}

test('shows canonical survival state and keeps inventory input isolated', async ({ page }) => {
  await startHarnessWorld(page, 'survival-ui');

  await expect(page.locator('#ui')).toHaveAttribute('data-ui-runtime', 'svelte5');
  await expect(page.getByRole('meter', { name: '生命' })).toHaveAttribute('aria-valuenow', '20');
  await expect(page.getByRole('meter', { name: '饥饿' })).toHaveAttribute('aria-valuenow', '20');
  await expect(page.getByRole('list', { name: '快捷栏' }).getByRole('listitem')).toHaveCount(8);

  await page.keyboard.press('KeyE');
  const inventory = page.getByRole('dialog', { name: '背包与合成' });
  await expect(inventory).toBeVisible();
  await expect(inventory.getByRole('grid', { name: '背包槽位' })).toBeVisible();
  await expect(inventory.getByRole('list', { name: '合成配方' })).toBeVisible();

  const positionBeforeTyping = await page.evaluate(() => window.__seedlandsHarness?.snapshot().player);
  await inventory.getByRole('textbox', { name: '筛选配方' }).fill('wasd12345678empt');
  const positionAfterTyping = await page.evaluate(() => window.__seedlandsHarness?.snapshot().player);
  expect(positionAfterTyping?.[0]).toBe(positionBeforeTyping?.[0]);
  expect(positionAfterTyping?.[2]).toBe(positionBeforeTyping?.[2]);
  await expect(page.locator('#macro-map-panel')).toBeHidden();
  await inventory.getByRole('textbox', { name: '筛选配方' }).press('Escape');
  await expect(inventory).toBeHidden();
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
});

test('completes gather, pickup, craft and place through the visible game flow', async ({ page }) => {
  await startHarnessWorld(page, 'survival-resource-loop');
  await runDebugCommand(page, '/setblock 0 32 0 stone');
  await runDebugCommand(page, '/setblock 0 33 -2 wood');
  await moveHarnessPlayer(page, 0.5, 34.6, 0.5);
  await setHarnessView(page, 0, -22);

  const canvas = page.locator('#game');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas has no visible bounding box.');
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const projectionStart = await page.evaluate(() => ({
    at: performance.now(),
    count: window.__seedlandsHarness?.snapshot().ui.interactionPublishCount ?? 0,
  }));
  await page.mouse.down({ button: 'left' });
  await expect(page.getByRole('progressbar', { name: '采集进度' })).toBeVisible();
  await expect(page.getByRole('status', { name: '交互反馈' })).toContainText(/采集|掉落/);
  await page.mouse.up({ button: 'left' });
  const projectionEnd = await page.evaluate(() => ({
    at: performance.now(),
    count: window.__seedlandsHarness?.snapshot().ui.interactionPublishCount ?? 0,
  }));
  const projectionSeconds = Math.max(0.05, (projectionEnd.at - projectionStart.at) / 1_000);
  expect(projectionEnd.count - projectionStart.count).toBeLessThanOrEqual(Math.ceil(projectionSeconds * 20) + 2);

  await expect(page.getByRole('img', { name: /原木掉落物/ })).toBeVisible();
  await page.keyboard.down('KeyW');
  await expect(page.getByRole('status', { name: '交互反馈' })).toContainText('拾取');
  await page.keyboard.up('KeyW');

  await page.keyboard.press('KeyE');
  const inventory = page.getByRole('dialog', { name: '背包与合成' });
  await expect(inventory.getByRole('gridcell', { name: /原木.*1/ })).toBeVisible();
  await inventory.getByRole('button', { name: /合成.*木板/ }).click();
  await expect(inventory.getByRole('gridcell', { name: /木板.*4/ })).toBeVisible();
  await inventory.getByRole('button', { name: /合成.*木斧/ }).click();
  await expect(inventory.getByRole('gridcell', { name: /木斧.*1/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await runDebugCommand(page, '/give dirt-block 1');
  await page.keyboard.press('Digit3');
  await canvas.click({ button: 'right', position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.getByRole('status', { name: '交互反馈' })).toContainText('放置');
});

test('survives damage, death, respawn and browser reload', async ({ page }) => {
  await startHarnessWorld(page, 'survival-death-persistence');
  const player = await page.evaluate(() => window.__seedlandsHarness?.snapshot().player);
  if (!player) throw new Error('Harness player position is unavailable.');
  await runDebugCommand(page, `/spawn creature ${player[0]} ${player[1]} ${player[2] - 2}`);
  await setHarnessView(page, 0, 0);
  const creature = page.getByRole('img', { name: '静止生物' });
  await expect(creature).toBeVisible();
  const canvas = page.locator('#game');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas has no visible bounding box.');
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  for (let hit = 0; hit < 3; hit += 1) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    if (hit < 2) await page.evaluate(() => window.__seedlandsHarness?.advanceGameplay(0.5));
  }
  await expect(creature).toBeHidden();

  await runDebugCommand(page, '/give berry 2');
  await runDebugCommand(page, '/damage 20');

  const deathDialog = page.getByRole('dialog', { name: '你倒下了' });
  await expect(deathDialog).toBeVisible();
  await expect(page.getByRole('meter', { name: '生命' })).toHaveAttribute('aria-valuenow', '0');
  await deathDialog.getByRole('button', { name: '复活' }).click();
  await expect(deathDialog).toBeHidden();
  await expect(page.getByRole('meter', { name: '生命' })).toHaveAttribute('aria-valuenow', '20');
  await expect(page.getByRole('meter', { name: '饥饿' })).toHaveAttribute('aria-valuenow', '20');
  await expect(page.getByRole('img', { name: /浆果掉落物/ })).toBeVisible();

  await runDebugCommand(page, '/save');
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '进入世界' }).click();
  await expect(page.getByRole('meter', { name: '生命' })).toHaveAttribute('aria-valuenow', '20');
  await expect(page.getByRole('img', { name: /浆果掉落物/ })).toBeVisible();
});
