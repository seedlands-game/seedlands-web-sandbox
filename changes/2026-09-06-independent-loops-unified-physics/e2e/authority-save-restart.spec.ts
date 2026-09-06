import { expect, test, type Page } from '@playwright/test';
import { startHarnessWorld } from '../../../tests/e2e/support/harness';

type CommandResult = { success: boolean; data?: { commitSequence?: number }; error?: unknown };
const save = (page: Page) =>
  page.evaluate(() => window.__seedlandsHarness!.executeGameplayCommand({ type: 'save' })) as Promise<CommandResult>;

test('重载较长会话后立即保存仍确认成功，提交序号不倒退', async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  await startHarnessWorld(page, 'authority-checkpoint-restart');
  await expect
    .poll(() => page.evaluate(() => window.__seedlandsHarness!.snapshot().authority.physicsTick), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(600);
  const before = await save(page);
  expect(before.success).toBe(true);
  expect(before.data?.commitSequence).toBeGreaterThanOrEqual(600);

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '进入世界' }).click();
  await page.locator('#debug').waitFor({ state: 'visible', timeout: 15_000 });
  const after = await save(page);
  await testInfo.attach('save-checkpoints', {
    body: JSON.stringify({ before, after }, null, 2),
    contentType: 'application/json',
  });
  expect(after.success).toBe(true);
  expect(after.data?.commitSequence).toBeGreaterThanOrEqual(before.data!.commitSequence!);
});
