import { expect, test, type Page } from '@playwright/test';
import type { HarnessApi } from '../../../src/app/game-harness';
import { startHarnessWorld } from '../../../tests/e2e/support/harness';

const snapshot = (page: Page) => page.evaluate(() => (window.__seedlandsHarness as unknown as HarnessApi).snapshot());
const workers = async (page: Page) => {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    const { targetInfos } = await cdp.send('Target.getTargets');
    return targetInfos
      .filter((info) => info.type === 'worker' && info.browserContextId === targetInfo.browserContextId)
      .map((info) => ({ id: info.targetId, url: info.url }));
  } finally {
    await cdp.detach();
  }
};

test('主线程阻塞500ms时权威Worker仍实际积分，恢复后不伪造时钟追平', async ({ page }, testInfo) => {
  await startHarnessWorld(page, 'authority-main-thread-stall');
  const before = await snapshot(page);
  const blockedMs = await page.evaluate(() => {
    const start = performance.now();
    while (performance.now() - start < 500) {
      /* 仅本change明确注入主线程故障。 */
    }
    return performance.now() - start;
  });
  const after = await snapshot(page);
  await testInfo.attach('main-stall-authority-progress', {
    body: JSON.stringify({ blockedMs, before: before.authority, after: after.authority }),
    contentType: 'application/json',
  });
  expect(blockedMs).toBeGreaterThanOrEqual(500);
  // 一次唤醒最多追赶4步；立即已有25步以上，证明在阻塞期间实际推进。
  expect(after.authority.physicsTick - before.authority.physicsTick).toBeGreaterThanOrEqual(25);
  expect(after.authority.integratedPhysicsTimeMs - before.authority.integratedPhysicsTimeMs).toBeGreaterThanOrEqual(
    400,
  );
  expect(after.authority.physicsDebtMs - before.authority.physicsDebtMs).toBeLessThanOrEqual(100);
});

test('连续切换世界回收全部旧Worker且拒绝旧epoch可见提交', async ({ page }, testInfo) => {
  await startHarnessWorld(page, 'authority-lifecycle-first');
  let previous = await workers(page);
  expect(previous).toHaveLength(5);
  const lifecycle = await page.evaluate(() => (window.__seedlandsHarness as unknown as HarnessApi).lifecycleSnapshot());
  const evidence = [{ seed: 'first', workers: previous }];
  for (const seed of ['authority-lifecycle-second', 'authority-lifecycle-third']) {
    await page.evaluate(
      async (seedText) => await (window.__seedlandsHarness as unknown as HarnessApi).restartWorld(seedText),
      seed,
    );
    await expect.poll(async () => (await workers(page)).length).toBe(5);
    const next = await workers(page);
    expect(next.some((worker) => previous.some((old) => old.id === worker.id))).toBe(false);
    previous = next;
    evidence.push({ seed, workers: next });
  }
  const after = await page.evaluate(() => (window.__seedlandsHarness as unknown as HarnessApi).lifecycleSnapshot());
  await testInfo.attach('actual-worker-world-lifecycle', {
    body: JSON.stringify({ evidence, lifecycle, after }),
    contentType: 'application/json',
  });
  expect(after.worldInstanceId).toBe(lifecycle.worldInstanceId + 2);
  expect(after.disposedWorlds).toBe(lifecycle.disposedWorlds + 2);
  expect(after.staleVisibleCommits).toBe(0);
});
