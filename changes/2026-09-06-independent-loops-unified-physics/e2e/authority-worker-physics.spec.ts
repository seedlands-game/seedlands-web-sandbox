import { expect, test, type Page } from '@playwright/test';
import { lockPointer, snapshot, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

type IndependentSnapshot = Omit<NonNullable<Awaited<ReturnType<typeof snapshot>>>, 'runtime'> & {
  runtime: 'authority-worker';
  workers: { total: number; authority: number; logic: number; persistence: number; fluid: number; general: number };
  authority: {
    physicsTick: number;
    integratedPhysicsTimeMs: number;
    acknowledgedInputSequence: number;
    physicsDebtMs: number;
  };
  logic: { blockStartedCount: number; blockCompletedCount: number };
  trajectory: Array<{ physicsTick: number; activeTimeMs: number; position: [number, number, number] }>;
};
type IndependentHarness = {
  snapshot(): IndependentSnapshot;
  blockLogicWorker(ms: number): Promise<void>;
};
type BlockRecord = {
  now: number;
  tick: number;
  ack: number;
  x: number;
  z: number;
  debt: number;
  started: number;
  completed: number;
};
type TestWindow = Window & { __independentBlockRun?: Promise<BlockRecord[]> };
const independentSnapshot = (page: Page) =>
  page.evaluate(() =>
    (window.__seedlandsHarness as typeof window.__seedlandsHarness & IndependentHarness).snapshot(),
  ) as unknown as Promise<IndependentSnapshot>;

for (const generalWorkers of [1, 2] as const) {
  test(`生产会话通用池${generalWorkers}槽位的真实Worker拓扑符合全局预算`, async ({ page }, testInfo) => {
    await startHarnessWorld(page, 'authority-worker-topology', `&generalWorkers=${generalWorkers}`);
    const session = await page.context().newCDPSession(page);
    try {
      const { targetInfo: current } = await session.send('Target.getTargetInfo');
      const { targetInfos } = await session.send('Target.getTargets');
      const urls = targetInfos
        .filter((target) => target.type === 'worker' && target.browserContextId === current.browserContextId)
        .map((target) => target.url);
      for (const script of [
        'authority-worker',
        'game-logic-worker',
        'persistence-worker',
        'fluid-compute-worker',
        'world-worker',
      ])
        expect(
          urls.filter((url) => new RegExp(`/${script}(?:\\.ts|-[^/]+\\.js)(?:[?#]|$)`).test(url)),
          script,
        ).toHaveLength(script === 'world-worker' ? generalWorkers : 1);
      await testInfo.attach('actual-worker-targets', {
        body: JSON.stringify(urls, null, 2),
        contentType: 'application/json',
      });
      expect(urls).toHaveLength(4 + generalWorkers);
      const currentSnapshot = await independentSnapshot(page);
      expect(currentSnapshot.runtime).toBe('authority-worker');
      expect(currentSnapshot.workers).toEqual({
        total: 4 + generalWorkers,
        authority: 1,
        logic: 1,
        persistence: 1,
        fluid: 1,
        general: generalWorkers,
      });
    } finally {
      await session.detach();
    }
  });
}

test('Logic实际阻塞窗口内Authority仍消费真实输入并移动，绘图持续', async ({ page }, testInfo) => {
  await startHarnessWorld(page, 'logic-worker-stall');
  await page.evaluate(async () => {
    await window.__seedlandsHarness!.prepareFlatMovement();
  });
  await waitForSnapshot(
    page,
    (current) =>
      current.onGround &&
      !current.colliding &&
      current.generationQueue === 0 &&
      current.meshingQueue === 0 &&
      current.performance.uploadQueueDepth === 0,
  );
  await page.bringToFront();
  await lockPointer(page);
  const before = await independentSnapshot(page);
  await page.evaluate(() => {
    const harness = window.__seedlandsHarness as typeof window.__seedlandsHarness & IndependentHarness;
    const records: BlockRecord[] = [];
    const captureStartedAt = performance.now();
    let blockRequested = false;
    const capture = new Promise<BlockRecord[]>((resolve, reject) => {
      const frame = () => {
        const now = performance.now();
        if (!blockRequested && now - captureStartedAt >= 1_000) {
          blockRequested = true;
          void harness.blockLogicWorker(500).catch(reject);
        }
        const value = harness.snapshot();
        records.push({
          now,
          tick: value.authority.physicsTick,
          ack: value.authority.acknowledgedInputSequence,
          x: value.serverPlayerPosition[0],
          z: value.serverPlayerPosition[2],
          debt: value.authority.physicsDebtMs,
          started: value.logic.blockStartedCount,
          completed: value.logic.blockCompletedCount,
        });
        if (now - captureStartedAt >= 10_000) resolve(records);
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    (window as TestWindow).__independentBlockRun = capture;
  });
  await expect
    .poll(async () => (await independentSnapshot(page)).logic.blockStartedCount, { timeout: 3_000, intervals: [10] })
    .toBeGreaterThan(before.logic.blockStartedCount);
  await page.keyboard.down('KeyW');
  try {
    await expect
      .poll(async () => (await independentSnapshot(page)).logic.blockCompletedCount, {
        timeout: 2_000,
        intervals: [10],
      })
      .toBeGreaterThan(before.logic.blockCompletedCount);
  } finally {
    await page.keyboard.up('KeyW');
  }
  const records = await page.evaluate(async () => await (window as TestWindow).__independentBlockRun!);
  const during = records.filter(
    (record) =>
      record.started > before.logic.blockStartedCount && record.completed === before.logic.blockCompletedCount,
  );
  await testInfo.attach('logic-block-actual-frame-records', {
    body: JSON.stringify({ before, records, during }, null, 2),
    contentType: 'application/json',
  });
  expect(records.at(-1)!.now - records[0]!.now).toBeGreaterThanOrEqual(9_900);
  expect(during.length).toBeGreaterThan(5);
  const first = during[0]!,
    last = during.at(-1)!;
  expect(last.now - first.now).toBeGreaterThan(200);
  expect(last.tick - first.tick).toBeGreaterThan(5);
  expect(last.ack).toBeGreaterThan(first.ack);
  expect(Math.hypot(last.x - first.x, last.z - first.z)).toBeGreaterThan(0.2);
  expect(Math.max(...during.map((record) => record.debt)) - before.authority.physicsDebtMs).toBeLessThanOrEqual(100);
  expect(Math.max(...records.slice(1).map((record, index) => record.now - records[index]!.now))).toBeLessThanOrEqual(
    100,
  );
});

test('真实W被一格岸阻挡，W+Space以连续权威轨迹上岸', async ({ page }) => {
  await startHarnessWorld(page, 'authority-one-block-bank');
  await page.evaluate(async () => {
    const harness = window.__seedlandsHarness!;
    await harness.fillWorld({ from: [-2, 48, -5], to: [2, 48, 3], voxel: 3 });
    await harness.fillWorld({ from: [-2, 49, -5], to: [2, 53, 3], voxel: 0 });
    await harness.fillWorld({ from: [-2, 49, 0], to: [2, 49, 0], voxel: 3 });
    await harness.fillWorld({ from: [-2, 49, 1], to: [2, 49, 3], voxel: 8 });
    await harness.movePlayerTo(0.5, 50.6, 2.2);
    harness.setView(0, 0);
  });
  await waitForSnapshot(page, (current) => !current.colliding);
  await page.bringToFront();
  await lockPointer(page);
  const start = await independentSnapshot(page);
  await page.keyboard.down('KeyW');
  try {
    await expect
      .poll(async () => (await independentSnapshot(page)).authority.physicsTick)
      .toBeGreaterThan(start.authority.physicsTick + 30);
  } finally {
    await page.keyboard.up('KeyW');
  }
  const blocked = await independentSnapshot(page);
  expect(blocked.serverPlayerPosition[2]).toBeGreaterThanOrEqual(1.32 - 1e-4);
  expect(blocked.serverPlayerPosition[2]).toBeLessThan(1.45);
  expect(blocked.serverPlayerPosition[1]).toBeLessThanOrEqual(start.serverPlayerPosition[1] + 0.1);
  await page.evaluate(async () => {
    await window.__seedlandsHarness!.movePlayerTo(0.5, 50.6, 2.2);
    window.__seedlandsHarness!.setView(0, 0);
  });
  const reset = await independentSnapshot(page);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  try {
    await expect.poll(async () => (await independentSnapshot(page)).serverPlayerPosition[2]).toBeLessThan(0.4);
  } finally {
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyW');
  }
  const crossed = await independentSnapshot(page);
  expect(crossed.serverPlayerPosition[1]).toBeGreaterThan(51.5);
  expect(crossed.colliding).toBe(false);
  const trajectory = crossed.trajectory.filter((sample) => sample.physicsTick > reset.authority.physicsTick);
  expect(trajectory.length).toBeGreaterThan(5);
  for (let index = 1; index < trajectory.length; index += 1) {
    const previous = trajectory[index - 1]!,
      next = trajectory[index]!;
    const seconds = (next.physicsTick - previous.physicsTick) / 60;
    expect(seconds).toBeGreaterThan(0);
    expect(Math.abs(next.position[1] - previous.position[1])).toBeLessThanOrEqual(24 * seconds + 1e-4);
    expect(
      Math.hypot(next.position[0] - previous.position[0], next.position[2] - previous.position[2]),
    ).toBeLessThanOrEqual(4.5 * seconds + 1e-4);
  }
  expect(trajectory.some((sample) => sample.position[1] > 50.8 && sample.position[1] < 51.5)).toBe(true);
});
