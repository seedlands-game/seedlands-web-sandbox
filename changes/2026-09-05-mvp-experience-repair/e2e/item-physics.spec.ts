import { expect, test, type Page } from '@playwright/test';
import { startHarnessWorld } from '../../../tests/e2e/support/harness';
import type { ServerCommand } from '../../../src/server/commands/command-contract';

type CommandResult = { success: boolean; data?: Record<string, unknown> };
type Entity = { id: string; position: [number, number, number]; stack?: { itemId: string; count: number } };

const command = (page: Page, value: ServerCommand) =>
  page.evaluate((input) => window.__seedlandsHarness!.executeGameplayCommand(input) as Promise<CommandResult>, value);

const entity = async (page: Page, entityId: string): Promise<Entity | null> => {
  const result = await command(page, { type: 'query-entity', entityId });
  if (!result.success) throw new Error(`Could not query entity ${entityId}.`);
  return (result.data?.entity as Entity | null | undefined) ?? null;
};
const serverPlayerPosition = (page: Page) =>
  page.evaluate(() => window.__seedlandsHarness!.snapshot().serverPlayerPosition);

test('world items use authoritative gravity, land after a support change, and absorb once', async ({ page }) => {
  await startHarnessWorld(page, 'item-physics-change');
  await page.evaluate(() => {
    const harness = window.__seedlandsHarness!;
    for (let x = -1; x <= 4; x += 1) {
      harness.setVoxelAt(x, 57, 0, 3);
      for (let y = 58; y <= 70; y += 1) harness.setVoxelAt(x, y, 0, 0);
    }
  });
  expect(await command(page, { type: 'teleport', position: [0.5, 58, 0.5] })).toMatchObject({ success: true });

  const falling = await command(page, {
    type: 'spawn-world-item',
    itemId: 'wood-block',
    count: 1,
    position: [3.5, 62, 0.5],
  });
  const fallingId = (falling.data?.entity as Entity | undefined)?.id ?? '';
  expect(fallingId).not.toBe('');
  expect(await command(page, { type: 'advance-gameplay', seconds: 0.2 })).toMatchObject({ success: true });
  expect((await entity(page, fallingId))?.position[1]).toBeLessThan(62);
  expect(await command(page, { type: 'advance-gameplay', seconds: 2 })).toMatchObject({ success: true });
  expect((await entity(page, fallingId))?.position[1]).toBeCloseTo(58.2, 3);

  await page.evaluate(() => window.__seedlandsHarness!.setVoxelAt(3, 57, 0, 0));
  expect(await command(page, { type: 'advance-gameplay', seconds: 0.5 })).toMatchObject({ success: true });
  expect((await entity(page, fallingId))?.position[1]).toBeLessThan(58.1);

  await command(page, { type: 'teleport', position: [0.5, 59.6, 0.5] });
  await expect
    .poll(async () => {
      const position = await serverPlayerPosition(page);
      return Math.hypot(position[0] - 0.5, position[1] - 59.6, position[2] - 0.5);
    })
    .toBeLessThan(0.0001);
  const playerPosition = await serverPlayerPosition(page);
  const attracted = await command(page, {
    type: 'spawn-world-item',
    itemId: 'berry',
    count: 1,
    position: [playerPosition[0] + 1.5, playerPosition[1] - 1.4, playerPosition[2]],
  });
  const attractedId = (attracted.data?.entity as Entity | undefined)?.id ?? '';
  expect(attractedId).not.toBe('');
  expect(await entity(page, attractedId)).not.toBeNull();
  await expect.poll(() => entity(page, attractedId)).toBeNull();
  const inventory = await command(page, { type: 'query-inventory' });
  expect(inventory).toMatchObject({
    success: true,
    data: { inventory: { slots: expect.arrayContaining([expect.objectContaining({ itemId: 'berry', count: 1 })]) } },
  });
});
