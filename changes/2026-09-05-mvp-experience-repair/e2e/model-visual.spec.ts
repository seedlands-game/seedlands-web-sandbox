import { expect, test, type Page } from '@playwright/test';
import { startHarnessWorld } from '../../../tests/e2e/support/harness';
import type { ServerCommand } from '../../../src/server/commands/command-contract';

type EntitySnapshot = {
  id: string;
  type: 'creature' | 'npc' | 'world-item';
  archetype?: 'grazer' | 'night-stalker' | 'settler';
  position: [number, number, number];
  stack?: { itemId: string; count: number };
};
type CommandResult = { success: boolean; data?: { entity?: EntitySnapshot } };

const command = (page: Page, value: ServerCommand) =>
  page.evaluate((input) => window.__seedlandsHarness!.executeGameplayCommand(input) as Promise<CommandResult>, value);

const entity = async (page: Page, entityId: string) => {
  const result = await command(page, { type: 'query-entity', entityId });
  if (!result.success) throw new Error(`Could not query ${entityId}.`);
  return result.data?.entity ?? null;
};

const spawnedId = (result: CommandResult) => {
  const id = result.data?.entity?.id;
  if (!id) throw new Error('Spawn command did not return an authoritative entity id.');
  return id;
};

test('生产世界同时呈现三类实体和掉落物', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await startHarnessWorld(page, 'model-visual-production');
  await page.keyboard.press('F3');
  await expect
    .poll(() => page.evaluate(() => window.__seedlandsHarness!.snapshot().renderedChunks))
    .toBeGreaterThan(10);

  await page.evaluate(() => {
    const h = window.__seedlandsHarness!;
    for (let x = -4; x <= 4; x += 1) {
      for (let z = -2; z <= 1; z += 1) h.setVoxelAt(x, 57, z, 3);
      for (let y = 58; y <= 64; y += 1) h.setVoxelAt(x, y, 0, 0);
    }
    h.setTimePaused(true);
    h.setWorldTime(10);
    h.setSpectatorPosition(0.5, 59.5, 5);
    h.setView(0, -8);
  });

  await expect.poll(() => page.evaluate(() => window.__seedlandsHarness!.snapshot().generationQueue)).toBe(0);

  const grazerId = spawnedId(await command(page, { type: 'spawn-actor', archetype: 'grazer', position: [-2, 58, 0] }));
  const stalkerId = spawnedId(
    await command(page, { type: 'spawn-actor', archetype: 'night-stalker', position: [0, 58, 0] }),
  );
  const settlerId = spawnedId(await command(page, { type: 'spawn-actor', archetype: 'settler', position: [2, 58, 0] }));
  const dropId = spawnedId(
    await command(page, { type: 'spawn-world-item', itemId: 'lantern', count: 1, position: [3, 59, 0] }),
  );

  await expect.poll(() => entity(page, grazerId)).toMatchObject({ archetype: 'grazer', type: 'creature' });
  await expect.poll(() => entity(page, stalkerId)).toMatchObject({ archetype: 'night-stalker', type: 'creature' });
  await expect.poll(() => entity(page, settlerId)).toMatchObject({ archetype: 'settler', type: 'npc' });
  await expect
    .poll(() => entity(page, dropId))
    .toMatchObject({
      type: 'world-item',
      stack: { itemId: 'lantern', count: 1 },
    });

  await expect.poll(async () => (await entity(page, dropId))?.position[1]).toBeCloseTo(58.2, 3);
  await page.locator('#game').screenshot({
    path: 'changes/2026-09-05-mvp-experience-repair/evidence/models-production-back-1920.png',
  });

  await page.evaluate(() => {
    const h = window.__seedlandsHarness!;
    h.setSpectatorPosition(0.5, 59.5, -5);
    h.setView(180, -8);
  });
  await expect.poll(() => page.evaluate(() => window.__seedlandsHarness!.snapshot().generationQueue)).toBe(0);
  await page.locator('#game').screenshot({
    path: 'changes/2026-09-05-mvp-experience-repair/evidence/models-production-front-1920.png',
  });

  await page.evaluate(() => {
    const h = window.__seedlandsHarness!;
    h.setSpectatorPosition(5, 59.5, 0.5);
    h.setView(90, -8);
  });
  await expect.poll(() => page.evaluate(() => window.__seedlandsHarness!.snapshot().generationQueue)).toBe(0);
  await page.locator('#game').screenshot({
    path: 'changes/2026-09-05-mvp-experience-repair/evidence/models-production-side-1920.png',
  });

  await expect(command(page, { type: 'give-item', itemId: 'wood-axe', count: 1 })).resolves.toMatchObject({
    success: true,
  });
  await expect(command(page, { type: 'give-item', itemId: 'stone-pickaxe', count: 1 })).resolves.toMatchObject({
    success: true,
  });
  await page.keyboard.press('Digit1');
  await expect(page.locator('#hotbar button').nth(0)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#game').screenshot({
    path: 'changes/2026-09-05-mvp-experience-repair/evidence/world-wood-axe-1920.png',
  });
  await page.keyboard.press('Digit2');
  await expect(page.locator('#hotbar button').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#game').screenshot({
    path: 'changes/2026-09-05-mvp-experience-repair/evidence/world-stone-pickaxe-1920.png',
  });
});
