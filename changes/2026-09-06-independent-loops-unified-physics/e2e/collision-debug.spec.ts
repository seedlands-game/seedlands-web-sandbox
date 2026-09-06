import { expect, test, type Page } from '@playwright/test';
import type { HarnessApi } from '../../../src/app/game-harness';
import { prepareFlatMovement, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

const state = (page: Page) => page.evaluate(() => (window.__seedlandsHarness as unknown as HarnessApi).snapshot());
const chord = async (page: Page) => {
  await page.keyboard.down('F3');
  await page.keyboard.press('KeyB');
  await page.keyboard.up('F3');
};

test('F3+B完整消费，面板等价控制，关闭真实线框资源不残留', async ({ page }, testInfo) => {
  await startHarnessWorld(page, 'authority-collision-debug');
  await prepareFlatMovement(page);
  await page.evaluate(async () => {
    const h = window.__seedlandsHarness as unknown as HarnessApi;
    await h.setVoxelAt(0, 58, -3, 10);
    for (const command of [
      { type: 'spawn-actor', archetype: 'grazer', position: [3, 57, -3] },
      { type: 'spawn-world-item', itemId: 'stone-block', count: 1, position: [-1.5, 57, -5] },
    ] as const) {
      const result = await h.executeGameplayCommand(command);
      if (!result.success) throw new Error(result.error.message);
    }
    h.setView(0, 0);
  });
  await waitForSnapshot(
    page,
    (value) =>
      value.generationQueue === 0 &&
      value.meshingQueue === 0 &&
      value.deferredRemeshes === 0 &&
      value.performance.uploadQueueDepth === 0,
  );
  await page.bringToFront();
  if (await page.locator('#debug').isVisible()) await page.keyboard.press('F3');
  await expect(page.locator('#debug')).toBeHidden();
  const before = await state(page);
  expect(before.collisionDebug).toMatchObject({
    enabled: false,
    entityCount: 0,
    meshCount: 0,
    materialCount: 0,
    visibleBatchCount: 0,
    authorityRequestCount: 0,
  });
  await chord(page);
  await expect.poll(async () => (await state(page)).collisionDebug.visibleBatchCount).toBe(1);
  await expect(page.locator('#debug')).toBeHidden();
  await page.keyboard.press('F3');
  await expect(page.locator('#debug')).toBeVisible();
  await expect(page.locator('#debug')).toContainText('权威橙');
  await expect(page.locator('#debug')).toContainText('预测青');
  await expect(page.locator('#debug')).toContainText('球形传感器');
  await page.locator('#collision-debug-contacts').check();
  await page.locator('#collision-debug-contacts').blur();
  await testInfo.attach('collision-debug-enabled', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('F3');
  await expect(page.locator('#debug')).toBeHidden();
  await testInfo.attach('collision-debug-world', { body: await page.screenshot(), contentType: 'image/png' });
  await page.evaluate(() => window.__seedlandsHarness!.setView(0, -65));
  await testInfo.attach('collision-debug-player-sensors', { body: await page.screenshot(), contentType: 'image/png' });
  await page.evaluate(() => window.__seedlandsHarness!.setView(0, 0));
  await page.keyboard.press('F3');
  await expect(page.locator('#debug')).toBeVisible();
  const active = await state(page);
  expect(active.collisionDebug).toMatchObject({
    entityCount: 1,
    meshCount: 1,
    materialCount: 1,
    visibleBatchCount: 1,
    authorityRequestCount: 0,
  });
  expect(active.collisionDebug.vertexCapacity).toBeGreaterThan(24);
  await page.locator('#collision-debug-toggle').click();
  await expect.poll(async () => (await state(page)).collisionDebug.enabled).toBe(false);
  for (let index = 0; index < 3; index++) {
    await page.locator('#collision-debug-toggle').click();
    await expect.poll(async () => (await state(page)).collisionDebug.visibleBatchCount).toBe(1);
    await page.locator('#collision-debug-toggle').click();
  }
  const disabled = await state(page);
  expect(disabled.collisionDebug).toMatchObject({
    enabled: false,
    entityCount: 0,
    meshCount: 0,
    materialCount: 0,
    visibleBatchCount: 0,
    vertexCapacity: 0,
    authorityRequestCount: 0,
  });
  await expect
    .poll(async () => (await state(page)).authority.physicsTick)
    .toBeGreaterThan(disabled.authority.physicsTick + 15);
  const final = await state(page);
  expect(final.collisionDebug.buildCount).toBe(disabled.collisionDebug.buildCount);
  expect(final.colliding).toBe(false);
  expect(final.serverPlayerPosition).toEqual(before.serverPlayerPosition);
  await testInfo.attach('collision-debug-disabled', { body: await page.screenshot(), contentType: 'image/png' });
  await testInfo.attach('collision-debug-resource-cycles', {
    body: JSON.stringify({
      before: before.collisionDebug,
      active: active.collisionDebug,
      disabled: disabled.collisionDebug,
      final: final.collisionDebug,
    }),
    contentType: 'application/json',
  });
});
