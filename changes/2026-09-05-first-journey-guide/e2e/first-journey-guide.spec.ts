import { expect, test } from '@playwright/test';

test('推荐起点可选可改，指南说明真实生存路线', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '推荐起点：林间河岸', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '世界 Seed', exact: true })).toHaveValue('mosslight-68');
  await expect(page.getByRole('button', { name: '进入世界', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '世界 Seed', exact: true }).fill('my-own-world');
  await page.getByRole('button', { name: '操作指南', exact: true }).click();
  const guide = page.getByRole('dialog', { name: '操作指南', exact: true });
  await expect(guide).toContainText('阶梯');
  await expect(guide).toContainText('灯笼');
  await expect(guide).toContainText('浆果');
  await guide.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '世界 Seed', exact: true })).toHaveValue('my-own-world');
});
