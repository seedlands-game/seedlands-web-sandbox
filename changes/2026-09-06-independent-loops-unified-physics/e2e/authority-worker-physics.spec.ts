import { expect, test, type Page } from '@playwright/test';
import { lockPointer, snapshot, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

type IndependentSnapshot = NonNullable<Awaited<ReturnType<typeof snapshot>>> & {
  runtime: 'authority-worker';
  workers: {
    total: number;
    authority: number;
    logic: number;
    persistence: number;
    fluid: number;
    general: number;
  };
  authority: { physicsTick: number; integratedPhysicsTimeMs: number; acknowledgedInputSequence: number };
};

type IndependentHarness = {
  snapshot(): IndependentSnapshot;
  blockLogicWorker(ms: number): void;
};

const independentSnapshot = (page: Page) =>
  page.evaluate(() => (window.__seedlandsHarness as typeof window.__seedlandsHarness & IndependentHarness).snapshot());

test('生产会话只创建一个 Authority、一个 Logic、一个 Persistence 和不超过三个计算 Worker', async ({ page }) => {
  await startHarnessWorld(page, 'authority-worker-topology');

  const current = await independentSnapshot(page);
  expect(current.runtime).toBe('authority-worker');
  expect(current.workers).toEqual({
    total: 5,
    authority: 1,
    logic: 1,
    persistence: 1,
    fluid: 1,
    general: 1,
  });
});

test('Logic Worker 阻塞500ms时真实 Authority 物理和输入仍继续', async ({ page }) => {
  await startHarnessWorld(page, 'logic-worker-stall');
  await lockPointer(page);
  const before = await independentSnapshot(page);
  await page.evaluate(() =>
    (window.__seedlandsHarness as typeof window.__seedlandsHarness & IndependentHarness).blockLogicWorker(500),
  );
  await page.keyboard.down('KeyW');
  try {
    await expect
      .poll(async () => {
        const current = await independentSnapshot(page);
        return (
          current.authority.physicsTick - before.authority.physicsTick > 5 &&
          Math.hypot(current.player[0] - before.player[0], current.player[2] - before.player[2]) > 0.2
        );
      })
      .toBe(true);
  } finally {
    await page.keyboard.up('KeyW');
  }
});

test('真实W被一格岸侧面阻挡，W+Space经连续物理轨迹越过岸顶', async ({ page }) => {
  await startHarnessWorld(page, 'authority-one-block-bank');
  await page.evaluate(() => {
    const harness = window.__seedlandsHarness!;
    harness.fillWorld({ from: [-2, 48, -5], to: [2, 48, 3], voxel: 3 });
    harness.fillWorld({ from: [-2, 49, -5], to: [2, 53, 3], voxel: 0 });
    harness.fillWorld({ from: [-2, 49, 0], to: [2, 49, 0], voxel: 3 });
    harness.fillWorld({ from: [-2, 49, 1], to: [2, 49, 3], voxel: 8 });
    harness.movePlayerTo(0.5, 50.6, 2.2);
    harness.setView(0, 0);
  });
  await waitForSnapshot(page, (current) => !current.colliding);
  await lockPointer(page);
  const start = await independentSnapshot(page);
  expect(start.runtime).toBe('authority-worker');

  await page.keyboard.down('KeyW');
  try {
    await expect
      .poll(() => independentSnapshot(page).then((current) => current.authority.physicsTick))
      .toBeGreaterThan(start.authority.physicsTick + 15);
  } finally {
    await page.keyboard.up('KeyW');
  }
  const blocked = await independentSnapshot(page);
  expect(blocked.player[2]).toBeGreaterThan(0.62);
  expect(blocked.player[1]).toBeLessThanOrEqual(start.player[1] + 0.1);

  await page.evaluate(() => {
    const harness = window.__seedlandsHarness!;
    harness.movePlayerTo(0.5, 50.6, 2.2);
    harness.setView(0, 0);
  });
  const reset = await independentSnapshot(page);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  try {
    await expect.poll(() => independentSnapshot(page).then((current) => current.player[2])).toBeLessThan(0.4);
  } finally {
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyW');
  }
  const crossed = await independentSnapshot(page);
  expect(crossed.authority.physicsTick).toBeGreaterThan(reset.authority.physicsTick);
  expect(crossed.player[1]).toBeGreaterThan(start.player[1] + 0.2);
  expect(crossed.colliding).toBe(false);
});
