import { expect, test, type Page } from '@playwright/test';
import {
  lockPointer,
  prepareFlatMovement,
  snapshot,
  startHarnessWorld,
  waitForPlayerMovement,
} from '../../../tests/e2e/support/harness';

async function actorState(page: Page) {
  return page.evaluate(async () => {
    const result = await window.__seedlandsHarness!.world.checkpoint({ kind: 'export' });
    if (!result.ok || !result.data.snapshot) throw new Error('Checkpoint export failed.');
    const actor = result.data.snapshot.gameplay.entityStore.actors.find((entry) => entry.player);
    if (!actor) throw new Error('Player component snapshot missing.');
    return actor;
  });
}

test('真实目录、数字键、Space/Shift 飞行、安全切换与检查点恢复', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startHarnessWorld(page, 'composed-creative-input');
  await prepareFlatMovement(page);
  const initial = await actorState(page);
  await page.keyboard.press('KeyE');
  await page.getByRole('button', { name: '切换创造模式', exact: true }).click();
  await expect(page.locator('#actor-mode-status')).toHaveText('创造模式');
  const creativeDefaults = await actorState(page);
  await page.locator('#creative-catalog button[data-item="wood-block"]').click();
  await expect(page.locator('#hotbar [data-item="wood-block"]')).toHaveCount(1);
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await page.keyboard.press('Digit2');
  await page.keyboard.press('KeyE');
  await page.locator('#creative-catalog button[data-item="stone-block"]').click();
  await expect(page.locator('#hotbar li').nth(1).locator('button[data-item="stone-block"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: testInfo.outputPath('creative-catalog.png') });
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await expect(page.locator('#creative-vitals-inactive')).toBeVisible();
  await expect(page.locator('#flight-toggle')).toHaveCSS('position', 'absolute');
  const flightBox = (await page.locator('#flight-toggle').boundingBox())!;
  const pauseBox = (await page.locator('#pause-toggle').boundingBox())!;
  expect(flightBox.width).toBeLessThan(500);
  expect(flightBox.x + flightBox.width).toBeLessThan(pauseBox.x);
  const before = await snapshot(page);
  if (!before) throw new Error('Movement snapshot missing.');
  await lockPointer(page);
  await page.screenshot({ path: testInfo.outputPath('flight-ground.png') });
  await page.keyboard.down('Space');
  const raised = await waitForPlayerMovement(page, { axis: 1, start: before.player[1], minimumDelta: 2, direction: 1 });
  await page.keyboard.up('Space');
  await page.screenshot({ path: testInfo.outputPath('flight-raised.png') });
  expect(raised.serverPlayerPosition[1]).toBeGreaterThan(before.serverPlayerPosition[1] + 1);
  await page.keyboard.down('ShiftLeft');
  const lowered = await waitForPlayerMovement(page, {
    axis: 1,
    start: raised.player[1],
    minimumDelta: 1,
    direction: -1,
  });
  await page.keyboard.up('ShiftLeft');
  await page.screenshot({ path: testInfo.outputPath('flight-lowered.png') });
  expect(lowered.colliding).toBe(false);
  await page.keyboard.press('KeyE');
  await page.getByRole('button', { name: '切换生存模式', exact: true }).click();
  await expect(page.locator('#actor-mode-status')).toHaveText('生存模式');
  const survival = await actorState(page);
  expect(survival.inventory).toEqual(initial.inventory);
  expect(survival.equipment).toEqual(initial.equipment);
  expect(survival.flight?.enabled).toBe(false);
  expect(survival.creativeCatalog).toMatchObject({
    hotbar: ['wood-block', 'stone-block', ...creativeDefaults.creativeCatalog!.hotbar.slice(2)],
    selectedSlot: 1,
  });
  await page.getByRole('button', { name: '切换创造模式', exact: true }).click();
  await expect(page.locator('#actor-mode-status')).toHaveText('创造模式');
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await page.locator('#flight-toggle').click();
  await expect(page.locator('#flight-toggle')).toHaveAttribute('aria-label', '开启飞行');
  const saved = await actorState(page);
  const restored = await page.evaluate(async () => {
    const world = window.__seedlandsHarness!.world;
    const result = await world.checkpoint({ kind: 'export' });
    if (!result.ok || !result.data.snapshot) throw new Error('Checkpoint export failed.');
    return world.checkpoint({ kind: 'restore', snapshot: result.data.snapshot });
  });
  expect(restored.ok).toBe(true);
  const after = await actorState(page);
  expect(after.mode).toEqual(saved.mode);
  expect(after.flight).toEqual(saved.flight);
  expect(after.inventory).toEqual(initial.inventory);
  expect(after.creativeCatalog).toEqual(saved.creativeCatalog);
  await expect(page.locator('#hotbar')).toHaveAttribute('aria-label', '创造快捷栏');
  expect(errors).toEqual([]);
});

test('新世界入口选择创造模式，经真实 Worker 生效', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('./?harness=1', { waitUntil: 'networkidle' });
  await page.locator('#seed').fill('composed-created-creative');
  await page.locator('#actor-mode').selectOption('creative');
  await page.getByRole('button', { name: '进入世界', exact: true }).click();
  const warning = page.getByRole('button', { name: '仍然进入', exact: true });
  if (await warning.isVisible()) await warning.click();
  await expect(page.locator('#creative-vitals-inactive')).toBeVisible({ timeout: 30_000 });
  expect(await actorState(page)).toMatchObject({ mode: { value: 'creative' }, flight: { enabled: true } });
});
