import { expect, test } from '@playwright/test';
import { snapshot, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test('naturally presents and advances passive, hostile and scheduled NPC actors', async ({ page }) => {
  await startHarnessWorld(page, 'living-world-autonomy');
  await waitForSnapshot(page, (current) => current.onGround);

  const grazer = page.getByRole('img', { name: /温顺林鹿/ });
  const hostile = page.getByRole('img', { name: /夜行兽/ });
  const settler = page.getByRole('img', { name: /营地居民/ });
  await expect(grazer).toHaveCount(1);
  await expect(hostile).toHaveCount(1);
  await expect(settler).toHaveCount(1);
  const before = await settler.getAttribute('data-position');
  await page.evaluate(() => window.__seedlandsHarness?.advanceGameplay(4));
  await expect.poll(() => settler.getAttribute('data-position')).not.toBe(before);
  await expect(settler).toHaveAttribute('data-behavior', /routine-work|seek-food/);

  for (let hour = 0; hour < 10; hour += 1) await page.keyboard.press('BracketRight');
  const healthBefore = Number(await page.getByRole('meter', { name: '生命' }).getAttribute('aria-valuenow'));
  await page.evaluate(() => window.__seedlandsHarness?.advanceGameplay(12));
  await expect
    .poll(async () => Number(await page.getByRole('meter', { name: '生命' }).getAttribute('aria-valuenow')))
    .toBeLessThan(healthBefore);
  await expect(hostile).toHaveAttribute('data-behavior', /chase|attack/);

  await page.keyboard.press('F4');
  const shell = page.getByRole('dialog', { name: '服务端调试命令' });
  await shell.getByRole('textbox', { name: '命令' }).fill('/save');
  await shell.getByRole('textbox', { name: '命令' }).press('Enter');
  await expect(shell.getByRole('status')).toContainText('成功');
  await shell.getByRole('textbox', { name: '命令' }).press('Escape');
  const beforeReload = await snapshot(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '进入世界' }).click();
  await expect(page.getByRole('img', { name: /温顺林鹿|夜行兽|营地居民/ })).toHaveCount(3);
  const afterReload = await snapshot(page);
  expect(afterReload?.worldTime).toBeCloseTo(beforeReload!.worldTime, 1);
});

test('does not leak actor presenters across world sessions', async ({ page }) => {
  await startHarnessWorld(page, 'living-world-session-a');
  const firstIds = await page
    .getByRole('img', { name: /温顺林鹿|夜行兽|营地居民/ })
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-entity-id')));
  await page.evaluate(() => window.__seedlandsHarness?.restartWorld('living-world-session-b'));
  await expect(page.getByRole('img', { name: /温顺林鹿|夜行兽|营地居民/ })).toHaveCount(3);
  const secondIds = await page
    .getByRole('img', { name: /温顺林鹿|夜行兽|营地居民/ })
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-entity-id')));
  expect(secondIds).not.toEqual(firstIds);
});
