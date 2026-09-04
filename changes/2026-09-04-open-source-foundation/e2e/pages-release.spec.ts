import { expect, test } from '@playwright/test';

test('repository Pages build exposes its exact release identity', async ({ page }) => {
  await page.goto('./', { waitUntil: 'networkidle' });

  const watermark = page.locator('#build-watermark');
  await expect(watermark).toBeVisible();
  await expect(watermark).toHaveText('commit 0123456 · generator v2');
  await expect(watermark).toHaveAttribute('data-commit', '0123456789abcdef0123456789abcdef01234567');
});
