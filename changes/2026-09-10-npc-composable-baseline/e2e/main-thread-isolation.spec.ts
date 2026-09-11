import { expect, test } from '@playwright/test';
import { lifeSample, startLifeScene } from './support';

test('渲染主线程阻塞期间伙伴仍通过正常身体完成补给', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const character = await startLifeScene(page);
  const first = await lifeSample(page, character.entityId, 0);
  await page.evaluate(async () => {
    for (let index = 0; index < 30; index += 1) {
      const until = performance.now() + 300;
      while (performance.now() < until) {
        /* controlled render-thread stall */
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });
  const last = await lifeSample(page, character.entityId, 0);
  await testInfo.attach('main-thread-isolation', {
    body: JSON.stringify({ first, last }),
    contentType: 'application/json',
  });
  expect(last.simulationTime - first.simulationTime).toBeGreaterThanOrEqual(9);
  expect(
    last.observation.events.some((event) => event.type === 'activity-succeeded' && event.nodeId === 'hunger-action'),
  ).toBe(true);
  expect(last.observation.self.position).not.toEqual(first.observation.self.position);
  await page.keyboard.press('F3');
  await page.getByRole('navigation', { name: '诊断分类' }).getByRole('button', { name: '调度', exact: true }).click();
  const counters = page
    .locator('.diagnostics-row')
    .filter({ has: page.getByText('Logic 收到 / 拒绝', { exact: true }) });
  await expect(counters.locator('dd')).toHaveText(/^\d+ \/ \d+/);
  await page.screenshot({ path: testInfo.outputPath('direct-logic-diagnostics.png') });
});
