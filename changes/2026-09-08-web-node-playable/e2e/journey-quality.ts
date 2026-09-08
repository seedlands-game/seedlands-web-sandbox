import { expect, type Page } from '@playwright/test';

export const journeyQuality = process.env.SEEDLANDS_WEB_NODE_QUALITY ?? 'medium';
if (!['low', 'medium', 'high'].includes(journeyQuality)) throw new Error('Unknown Web/Node journey quality.');

export async function selectJourneyQuality(page: Page): Promise<void> {
  await page.selectOption('#quality', journeyQuality);
  await expect(page.locator('#quality')).toHaveValue(journeyQuality);
}
