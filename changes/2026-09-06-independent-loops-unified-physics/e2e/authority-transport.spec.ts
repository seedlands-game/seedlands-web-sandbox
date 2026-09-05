import { expect, test } from '@playwright/test';
import {
  fillHarnessWorld,
  lockPointer,
  prepareFlatMovement,
  setHarnessView,
  snapshot,
  startHarnessWorld,
  waitForPlayerMovement,
  waitForSnapshot,
} from '../../../tests/e2e/support/harness';

type HarnessWindow = Window & {
  __seedlandsHarness?: {
    setVoxelAt: (x: number, y: number, z: number, voxel: number) => Promise<void>;
    getVoxelAt?: (x: number, y: number, z: number) => number | null;
    getChunkRevision?: (cx: number, cy: number, cz: number) => number | null;
  };
};

const setVoxel = (page: Parameters<typeof snapshot>[0], x: number, y: number, z: number, voxel: number) =>
  page.evaluate(
    async ([targetX, targetY, targetZ, value]) => {
      const harness = (window as HarnessWindow).__seedlandsHarness;
      if (!harness) throw new Error('Harness 世界编辑入口不可用。');
      await harness.setVoxelAt(targetX, targetY, targetZ, value);
    },
    [x, y, z, voxel] as const,
  );

const scenarios = [
  { physicsHz: 30, latencyMs: 0 },
  { physicsHz: 60, latencyMs: 50 },
  { physicsHz: 120, latencyMs: 150 },
] as const;

for (const scenario of scenarios) {
  test(`${scenario.physicsHz}Hz、${scenario.latencyMs}ms、重复乱序下维持移动与世界事务一次性`, async ({ page }) => {
    const query =
      `&physicsHz=${scenario.physicsHz}&authorityLatencyMs=${scenario.latencyMs}` +
      '&authorityDuplicate=1&authorityReorder=1';
    await startHarnessWorld(page, `authority-transport-${scenario.physicsHz}`, query);
    await prepareFlatMovement(page);
    const before = await snapshot(page);
    if (!before) throw new Error('受控传输测试启动后没有 Harness 快照。');

    await lockPointer(page);
    await setHarnessView(page, 0, 0);
    await page.keyboard.down('KeyW');
    const moved = await waitForPlayerMovement(page, {
      axis: 2,
      start: before.player[2],
      minimumDelta: 1,
      direction: -1,
      yTarget: before.player[1],
    });
    await page.keyboard.up('KeyW');
    expect(moved.colliding).toBe(false);
    const stopped = await waitForSnapshot(
      page,
      (current) => Math.hypot(current.serverPlayerVelocity[0], current.serverPlayerVelocity[2]) < 0.05,
    );
    expect(stopped.authority.acknowledgedInputSequence).toBeGreaterThan(moved.authority.acknowledgedInputSequence);
    const stoppedTick = stopped.authority.physicsTick;
    const stoppedPosition = stopped.serverPlayerPosition;
    await expect
      .poll(async () => (await snapshot(page))?.authority.physicsTick)
      .toBeGreaterThanOrEqual(stoppedTick + 30);
    const remainedStopped = await snapshot(page);
    if (!remainedStopped) throw new Error('输入中断后的 Harness 快照不可用。');
    expect(
      Math.hypot(
        remainedStopped.serverPlayerPosition[0] - stoppedPosition[0],
        remainedStopped.serverPlayerPosition[2] - stoppedPosition[2],
      ),
    ).toBeLessThan(0.08);

    await setVoxel(page, 8, 56, 8, 3);
    await page.waitForFunction(() => (window as HarnessWindow).__seedlandsHarness?.getVoxelAt?.(8, 56, 8) === 3);
    const placedRevision = await page.evaluate(
      () => (window as HarnessWindow).__seedlandsHarness?.getChunkRevision?.(0, 1, 0) ?? -1,
    );
    await setVoxel(page, 8, 56, 8, 0);
    await page.waitForFunction(() => (window as HarnessWindow).__seedlandsHarness?.getVoxelAt?.(8, 56, 8) === 0);
    await expect
      .poll(async () => (await snapshot(page))?.authority.commitSequence)
      .toBeGreaterThan(stopped.authority.commitSequence);
    const committed = await snapshot(page);
    if (!committed) throw new Error('世界事务提交后的 Harness 快照不可用。');
    expect(committed.lastCommitMutationCount).toBe(1);
    expect(
      await page.evaluate(() => (window as HarnessWindow).__seedlandsHarness?.getChunkRevision?.(0, 1, 0) ?? -1),
    ).toBeGreaterThan(placedRevision);
    expect(committed.authority.snapshotRejections['physics-tick-regressed']).toBeGreaterThan(0);
  });
}

test('150ms延迟下碰撞revision变化会重同步预测且不穿墙', async ({ page }) => {
  await startHarnessWorld(
    page,
    'authority-transport-wall',
    '&physicsHz=120&authorityLatencyMs=150&authorityDuplicate=1&authorityReorder=1',
  );
  await prepareFlatMovement(page);
  const before = await snapshot(page);
  if (!before) throw new Error('受控传输墙体测试启动后没有 Harness 快照。');
  expect(before.authority.physicsHz).toBe(120);
  expect(before.prediction.resetCounts['collision-history-missing'] ?? 0).toBe(0);

  await lockPointer(page);
  await setHarnessView(page, 0, 0);
  await page.keyboard.down('KeyW');
  await waitForPlayerMovement(page, { axis: 2, start: before.player[2], minimumDelta: 0.35, direction: -1 });
  await fillHarnessWorld(page, [-1, 57, -2], [1, 59, -2], 3);
  const corrected = await waitForSnapshot(
    page,
    (current) =>
      (current.prediction.resetCounts['collision-history-missing'] ?? 0) > 0 &&
      Math.hypot(current.serverPlayerVelocity[0], current.serverPlayerVelocity[2]) < 0.05,
  );
  await page.keyboard.up('KeyW');

  expect(corrected.colliding).toBe(false);
  expect(corrected.player[2]).toBeGreaterThanOrEqual(-0.680_01);
  expect(corrected.serverPlayerPosition[2]).toBeGreaterThanOrEqual(-0.680_01);
  expect(Math.abs(corrected.player[2] - corrected.serverPlayerPosition[2])).toBeLessThan(0.35);
});
