import { expect, test, type Page } from '@playwright/test';
import type { HarnessApi } from '../../../src/app/game-harness';
import { lockPointer, prepareFlatMovement, startHarnessWorld } from '../../../tests/e2e/support/harness';

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

test('暂停可靠冻结且恢复不粘键，权威Worker故障明确退出并允许重试', async ({ page }, testInfo) => {
  await startHarnessWorld(page, 'authority-pause-failure');
  await prepareFlatMovement(page);
  await lockPointer(page);
  const before = await snapshot(page);
  await page.keyboard.down('KeyW');
  await expect
    .poll(async () => (await snapshot(page)).serverPlayerPosition[2])
    .toBeLessThan(before.serverPlayerPosition[2] - 0.5);
  await page.keyboard.press('Escape');
  await page.keyboard.up('KeyW');
  await expect(page.getByRole('dialog', { name: '暂停游戏' })).toBeVisible();
  const paused = await snapshot(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const sample = () => {
          if (++frames >= 120) resolve();
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  const frozen = await snapshot(page);
  expect(frozen.authority.physicsTick).toBe(paused.authority.physicsTick);
  expect(frozen.serverPlayerPosition).toEqual(paused.serverPlayerPosition);
  await page.getByRole('button', { name: '继续游戏', exact: true }).click();
  await expect
    .poll(async () => (await snapshot(page)).authority.physicsTick)
    .toBeGreaterThan(frozen.authority.physicsTick + 30);
  const resumed = await snapshot(page);
  expect(Math.hypot(resumed.serverPlayerVelocity[0], resumed.serverPlayerVelocity[2])).toBeLessThan(0.05);
  expect(resumed.authority.physicsDebtMs).toBeLessThan(100);
  await testInfo.attach('reliable-pause-resume', {
    body: JSON.stringify({ paused: paused.authority, frozen: frozen.authority, resumed: resumed.authority }),
    contentType: 'application/json',
  });

  const authorityWorker = page.workers().find((worker) => worker.url().includes('authority-worker'));
  expect(authorityWorker).toBeDefined();
  // 真实Worker事件循环的未捕获异常经过生产onerror路径，不修改诊断字段。
  await authorityWorker!.evaluate(() => {
    setTimeout(() => {
      throw new Error('authority-e2e-failure');
    }, 0);
  });
  await expect(page.locator('#start-card')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('authority-e2e-failure');
  await expect.poll(async () => (await workers(page)).length).toBe(0);
  await testInfo.attach('authority-failure-visible', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByRole('button', { name: '重新进入世界', exact: true }).click();
  await expect(page.locator('#start-card')).toBeHidden();
  await expect.poll(async () => (await workers(page)).length).toBe(5);
  expect((await snapshot(page)).authority.physicsTick).toBeGreaterThan(0);
});
