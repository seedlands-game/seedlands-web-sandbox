import { expect, test } from '@playwright/test';
import { startHarnessWorld } from '../support/harness';

test('renders the deterministic Macro map and changes its visible data layer', async ({ page }) => {
  await startHarnessWorld(page, 'seedlands-macro-map-regression');
  await page.getByRole('button', { name: 'Macro 地图' }).click();
  const panel = page.getByLabel('Macro 世界地图总览');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });

  await page.getByLabel('图层').selectOption('hydrology');
  await expect(panel).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
  await expect(page.locator('#macro-map')).toBeVisible();
});
