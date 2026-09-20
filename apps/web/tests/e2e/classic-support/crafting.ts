import { expect, type Page } from '@playwright/test';
import { inventory, closeInventory, playerState } from './harness';

export async function craftAndEquipBuildingPlanks(page: Page): Promise<void> {
  const panel = await inventory(page);
  await expect(panel.locator('[data-inventory-address^="inventory:"]')).toHaveCount(36);
  await expect(panel.locator('[data-slot="35"]')).toBeVisible();
  expect((await playerState(page)).hotbarSize).toBe(9);
  await expect(panel.getByRole('gridcell', { name: '原木 × 4', exact: true })).toBeVisible();
  await expect(panel.getByRole('gridcell', { name: '浆果 × 1', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '合成 木板', exact: true }).click();
  await panel.getByRole('button', { name: '合成 木板', exact: true }).click();
  await panel.getByRole('button', { name: '合成 木板', exact: true }).click();
  await panel.getByRole('button', { name: '合成 木棍', exact: true }).click();
  await panel.getByRole('button', { name: '合成 木斧', exact: true }).click();
  await panel.getByRole('button', { name: '合成 木剑', exact: true }).click();
  await panel.getByRole('button', { name: '合成 工作台', exact: true }).click();
  await expect(panel.getByRole('gridcell', { name: /^木斧 × 1 · 耐久 60\/60$/ })).toBeVisible();
  await expect(panel.getByRole('gridcell', { name: '木剑 × 1', exact: true })).toBeVisible();
  await expect(panel.getByRole('gridcell', { name: '工作台 × 1', exact: true })).toBeVisible();
  const planks = panel.getByRole('gridcell', { name: /^木板 × / }).first();
  await planks.hover();
  await page.keyboard.press('Digit9');
  await expect(panel.locator('[data-slot="8"]')).toHaveAttribute('data-item', 'plank');
  await closeInventory(page);
  await page.keyboard.press('Digit9');
  await expect.poll(async () => (await playerState(page)).selectedSlot).toBe(8);
}
