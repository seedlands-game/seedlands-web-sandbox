import { expect, test } from '@playwright/test';
import { lockPointer, snapshot, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test('当前自主世界的死亡掉落经复活、保存和刷新继续保持身份与数量', async ({ page }) => {
  await startHarnessWorld(page, 'living-world-autonomy');
  const start = await waitForSnapshot(page, (s) => s.onGround && !s.colliding);
  const berries = page.getByRole('img', { name: '浆果掉落物', exact: true });
  const ids = () => berries.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-entity-id')!));
  const naturalIds = await ids();
  await page.evaluate(() => window.__seedlandsHarness!.setView(180, 0));
  await lockPointer(page);
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await snapshot(page))!.player[2] - start.player[2]).toBeGreaterThan(8);
  await page.keyboard.up('KeyW');
  const given = await page.evaluate(() =>
    window.__seedlandsHarness!.executeGameplayCommand({ type: 'give-item', itemId: 'berry', count: 2 }),
  );
  expect(given.success).toBe(true);
  await page.evaluate(() => window.__seedlandsHarness!.executeGameplayCommand({ type: 'apply-damage', amount: 20 }));
  const death = page.getByRole('dialog', { name: '你倒下了', exact: true });
  await expect(death).toBeVisible();
  await expect.poll(async () => (await ids()).filter((id) => !naturalIds.includes(id)).length).toBe(1);
  const dropId = (await ids()).find((id) => !naturalIds.includes(id))!;
  const readDrop = () =>
    page.evaluate(
      (entityId) => window.__seedlandsHarness!.executeGameplayCommand({ type: 'query-entity', entityId }),
      dropId,
    );
  expect(await readDrop()).toMatchObject({
    success: true,
    data: { entity: { id: dropId, stack: { itemId: 'berry', count: 2 } } },
  });
  await death.getByRole('button', { name: '复活', exact: true }).click();
  await expect(death).toBeHidden();
  await expect(page.getByRole('meter', { name: '生命' })).toHaveAttribute('aria-valuenow', '20');
  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  await page.getByRole('button', { name: '保存并返回主菜单', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '继续世界', exact: true }).click();
  await waitForSnapshot(page, (s) => s.onGround && !s.colliding);
  await expect(page.getByRole('meter', { name: '生命' })).toHaveAttribute('aria-valuenow', '20');
  await expect(page.locator(`[data-entity-id="${dropId}"]`)).toHaveCount(1);
  expect(await readDrop()).toMatchObject({
    success: true,
    data: { entity: { id: dropId, stack: { itemId: 'berry', count: 2 } } },
  });
});
