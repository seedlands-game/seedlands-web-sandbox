import { expect, test } from '@playwright/test';
import { startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test('F3 分类仪表板展示真实调度与缺失测量，小视口可操作', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const capture = async (name: string) => {
    const path = testInfo.outputPath(name);
    await page.screenshot({ animations: 'disabled', path });
    await testInfo.attach(name, { path, contentType: 'image/png' });
  };
  await startHarnessWorld(page, 'harness-diagnostics');
  await waitForSnapshot(page, (snapshot) => snapshot.loadedChunks > 10);
  const panel = page.locator('#debug');
  await expect(panel).toBeVisible();
  await page.mouse.click(1000, 360);
  await expect.poll(() => page.evaluate(() => Boolean(document.pointerLockElement))).toBe(true);
  await page.keyboard.press('F3');
  await expect(panel).toBeHidden();
  await page.keyboard.press('F3');
  await expect(panel).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(document.pointerLockElement))).toBe(false);
  await expect(page.getByRole('dialog', { name: '暂停游戏', exact: true })).toBeHidden();
  await expect(panel.locator('[data-group=overview]')).toBeVisible();
  await expect(panel.getByRole('navigation', { name: '诊断分类' }).getByRole('button')).toHaveCount(6);
  await panel.getByRole('button', { name: '调度', exact: true }).click();
  await expect(panel).toContainText(/general #\d+/);
  await expect(panel).toContainText('CPU 占用率');
  await expect(panel.locator('[data-kind=unavailable]').filter({ hasText: 'OS 线程数' })).toContainText('未提供');
  await panel.getByRole('button', { name: 'Wasm', exact: true }).click();
  await expect(panel).toContainText('线性内存');
  await expect(panel.locator('.diagnostics-row').filter({ hasText: /general #\d+ 调用 \/ trap/ })).not.toContainText(
    '未提供',
  );
  const callsBeforeEdit = await page.evaluate(() =>
    (window.__seedlandsHarness!.snapshot().compute.workerActivity ?? []).reduce(
      (sum, worker) => sum + (worker.kernel?.calls ?? 0),
      0,
    ),
  );
  await page.evaluate(() => window.__seedlandsHarness!.setVoxelAt(2, 12, 2, 1));
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window.__seedlandsHarness!.snapshot().compute.workerActivity ?? []).reduce(
          (sum, worker) => sum + (worker.kernel?.calls ?? 0),
          0,
        ),
      ),
    )
    .toBeGreaterThan(callsBeforeEdit);
  await panel
    .locator('.diagnostics-row')
    .filter({ hasText: /general #\d+ 线性内存/ })
    .scrollIntoViewIfNeeded();
  await capture('debug-wasm.png');
  await panel.getByRole('button', { name: '概览', exact: true }).click();
  await expect(panel.getByRole('button', { name: '概览', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('button', { name: 'Wasm', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.locator('[data-group=overview]')).toBeVisible();
  await panel.locator('.diagnostics-scroll').evaluate((element) => {
    element.scrollTop = 0;
  });
  await capture('debug-overview.png');
  await page.setViewportSize({ width: 800, height: 600 });
  await panel.getByRole('button', { name: '内存', exact: true }).click();
  await expect(panel).toContainText('不能相加当作进程总内存');
  await panel.getByRole('button', { name: '紧凑诊断布局' }).click();
  await expect(panel).toHaveClass(/compact/);
  const scroll = panel.getByRole('region', { name: '诊断详情' });
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await panel.locator('.collision-details summary').click();
  await expect(panel.locator('#collision-debug-toggle')).toBeVisible();
  const dimensions = await panel.boundingBox();
  expect(dimensions!.x + dimensions!.width).toBeLessThanOrEqual(800);
  expect(dimensions!.y + dimensions!.height).toBeLessThanOrEqual(600);
  await capture('debug-small.png');
});
