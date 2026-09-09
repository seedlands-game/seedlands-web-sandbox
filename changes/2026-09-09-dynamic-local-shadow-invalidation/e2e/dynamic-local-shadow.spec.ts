import { expect, test, type Page } from '@playwright/test';
import { snapshot, waitForSnapshot } from '../../../tests/e2e/support/harness';
import type { ServerCommand } from '../../../packages/game-core/src/server/commands/command-contract';

type CommandResult = { success: boolean; data?: { entity?: { id: string } } };

const command = (page: Page, input: ServerCommand) =>
  page.evaluate((value) => window.__seedlandsHarness!.executeGameplayCommand(value) as Promise<CommandResult>, input);

test('局部灯在掉落物移除后重画一次阴影且不依赖方块编辑', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto('./?harness=1');
  await page.locator('#quality').selectOption('high');
  await page.locator('#seed').fill('dynamic-local-shadow-invalidation');
  await page.getByRole('button', { name: '进入世界' }).click();
  const continueDespiteWarning = page.getByRole('button', { name: '仍然进入' });
  if (await continueDespiteWarning.isVisible()) await continueDespiteWarning.click();
  await page.locator('#start-card').waitFor({ state: 'hidden' });
  await page.locator('#debug').waitFor({ state: 'visible', timeout: 15_000 });

  await page.evaluate(async () => {
    const harness = window.__seedlandsHarness!;
    await harness.fillWorld({ from: [-5, 48, -9], to: [5, 54, 3], voxel: 3 });
    await harness.fillWorld({ from: [-4, 49, -8], to: [4, 53, 2], voxel: 0 });
    await harness.setVoxelAt(0, 49, -5, 10);
    harness.setSpectatorPosition(0.5, 51.2, 1.5);
    harness.setView(0, -8);
    await harness.setWorldTime(3);
    harness.setTimePaused(true);
  });
  const stable = await waitForSnapshot(
    page,
    (current) =>
      current.generationQueue === 0 &&
      current.meshingQueue === 0 &&
      current.deferredRemeshes === 0 &&
      current.visualEffects.activeLocalLights === 1 &&
      current.visualEffects.shadowStableFrameCount >= 2,
  );

  const spawned = await command(page, {
    type: 'spawn-world-item',
    itemId: 'stone-block',
    count: 1,
    position: [0.5, 50.2, -3.5],
  });
  const entityId = spawned.data?.entity?.id;
  expect(spawned.success).toBe(true);
  expect(entityId).toBeTruthy();
  await expect
    .poll(async () => {
      const current = await snapshot(page);
      return Boolean(
        current &&
        current.gameplay.worldItemCount === stable.gameplay.worldItemCount + 1 &&
        current.gameplay.presentedEntityCount === stable.gameplay.presentedEntityCount + 1 &&
        current.visualEffects.shadowUpdateCount > stable.visualEffects.shadowUpdateCount,
      );
    })
    .toBe(true);
  const withCaster = (await snapshot(page))!;
  expect(withCaster.worldRevision).toBe(stable.worldRevision);
  await page.locator('#game').screenshot({ path: testInfo.outputPath('with-shadow-caster.png') });

  const removal = await page.evaluate(async (id) => {
    const harness = window.__seedlandsHarness!;
    const result = (await harness.executeGameplayCommand({ type: 'despawn-entity', entityId: id })) as CommandResult;
    return { success: result.success, shadowUpdateCount: harness.snapshot().visualEffects.shadowUpdateCount };
  }, entityId!);
  expect(removal.success).toBe(true);
  await expect
    .poll(async () => {
      const current = await snapshot(page);
      return Boolean(
        current &&
        current.gameplay.worldItemCount === stable.gameplay.worldItemCount &&
        current.gameplay.presentedEntityCount === stable.gameplay.presentedEntityCount &&
        current.visualEffects.shadowUpdateCount > removal.shadowUpdateCount &&
        current.visualEffects.shadowStableFrameCount >= 2,
      );
    })
    .toBe(true);
  const afterRemoval = (await snapshot(page))!;
  expect(afterRemoval.worldRevision).toBe(stable.worldRevision);
  await page.locator('#game').screenshot({ path: testInfo.outputPath('after-shadow-caster-removal.png') });

  const settledCount = afterRemoval.visualEffects.shadowUpdateCount;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect((await snapshot(page))?.visualEffects.shadowUpdateCount).toBe(settledCount);
});
