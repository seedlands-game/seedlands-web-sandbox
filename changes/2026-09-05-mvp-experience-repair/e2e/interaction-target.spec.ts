import { expect, test, type Page } from '@playwright/test';
import { lockPointer, startHarnessWorld } from '../../../tests/e2e/support/harness';
import type { ServerCommand } from '../../../src/server/commands/command-contract';

type CommandResult = { success: boolean; data?: Record<string, unknown> };
const command = (page: Page, value: ServerCommand) =>
  page.evaluate((input) => window.__seedlandsHarness!.executeGameplayCommand(input) as Promise<CommandResult>, value);

test('可达方块的顶部目标卡与采集进度同源，超距、空处和UI阻断时隐藏', async ({ page }) => {
  await startHarnessWorld(page, 'interaction-target');
  await page.evaluate(() => {
    const harness = window.__seedlandsHarness!;
    harness.setSpectatorPosition(0.5, 58.5, 0.5);
    harness.setView(0, 0);
    harness.setVoxelAt(0, 58, -1, 2);
    harness.setVoxelAt(0, 58, -6, 2);
  });

  const card = page.locator('#target-card');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-target', '0,58,-1');
  await expect(card).toHaveAttribute('data-voxel', '2');

  await lockPointer(page);
  await page.mouse.down();
  await expect
    .poll(() => card.locator('progress').evaluate((node) => (node as HTMLProgressElement).value))
    .toBeGreaterThan(0);
  await page.mouse.up();

  await page.evaluate(() => window.__seedlandsHarness!.setVoxelAt(0, 58, -1, 0));
  await expect(card).toBeHidden();
  await page.keyboard.press('KeyE');
  await expect(card).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
});

test('实体攻击受命中方块距离限制，攻击间隔内不改为采集背后方块', async ({ page }) => {
  await startHarnessWorld(page, 'interaction-entity-wall');
  await page.evaluate(() => {
    const harness = window.__seedlandsHarness!;
    harness.setSpectatorPosition(0.5, 58.5, 0.5);
    harness.setView(0, 0);
    for (let x = -2; x <= 2; x++)
      for (let z = -4; z <= 2; z++) {
        harness.setVoxelAt(x, 57, z, 3);
        for (let y = 58; y <= 61; y++) harness.setVoxelAt(x, y, z, 0);
      }
    harness.setVoxelAt(0, 58, -1, 3);
  });
  expect(await command(page, { type: 'teleport', position: [0.5, 58.5, 0.5] })).toMatchObject({ success: true });
  const spawned = await command(page, { type: 'spawn-creature', position: [0.5, 58, -2.2] });
  const creatureId = (spawned.data?.entity as { id?: string } | undefined)?.id ?? '';
  expect(creatureId).not.toBe('');

  await lockPointer(page);
  await page.mouse.down();
  await page.mouse.up();
  const blocked = await command(page, { type: 'query-entity', entityId: creatureId });
  expect(blocked).toMatchObject({ success: true, data: { entity: { health: 12 } } });
  expect(await command(page, { type: 'inspect-voxel', position: [0, 58, -1] })).toMatchObject({
    success: true,
    data: { voxel: 3 },
  });

  await page.evaluate(() => window.__seedlandsHarness!.setVoxelAt(0, 58, -1, 0));

  await page.mouse.down();
  await page.mouse.up();
  const hit = await command(page, { type: 'query-entity', entityId: creatureId });
  expect(hit).toMatchObject({ success: true, data: { entity: { health: 8 } } });
});
