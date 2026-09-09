import { expect, test, type Page } from '@playwright/test';
import { Voxel } from '../../../packages/game-core/src/world/voxel';
import {
  type HarnessSnapshot,
  clickCanvasCenter,
  fillHarnessWorld,
  lockPointer,
  moveHarnessPlayer,
  prepareCenterExcavation,
  prepareFlatMovement,
  prepareStepDown,
  removeHarnessVoxel,
  setHarnessView,
  snapshot,
  startHarnessWorld,
  waitForPlayerMovement,
  waitForSnapshot,
} from '../support/harness';
import { writeBrowserE2EResult } from '../support/result';

const stages: Record<string, 'PASS' | 'FAIL'> = {
  load: 'FAIL',
  input: 'FAIL',
  player: 'FAIL',
  interaction: 'FAIL',
  streaming: 'FAIL',
  persistence: 'FAIL',
};
let browserMetrics: Readonly<{ ui: object; gameplay: object }> | undefined;

const waitForAuthorityFall = async (page: Page, before: HarnessSnapshot, requireInputAck = false) => {
  const sample = await page.waitForFunction(
    ({ height, tick, ack }) => {
      const current = window.__seedlandsHarness!.snapshot();
      return current.serverPlayerPosition[1] < height - 0.25 &&
        current.authority.physicsTick > tick + (ack === null ? 2 : 15) &&
        (ack === null || current.authority.acknowledgedInputSequence > ack) &&
        (ack !== null || !current.onGround)
        ? current
        : null;
    },
    {
      height: before.serverPlayerPosition[1],
      tick: before.authority.physicsTick,
      ack: requireInputAck ? before.authority.acknowledgedInputSequence : null,
    },
    { timeout: 15_000 },
  );
  try {
    const current = await sample.jsonValue();
    if (!current) throw new Error('Authority did not provide the requested falling sample.');
    return current;
  } finally {
    await sample.dispose();
  }
};

test.describe.serial('Seedlands deterministic browser regression', () => {
  test.afterAll(async () => {
    await writeBrowserE2EResult(stages, browserMetrics);
  });

  test('loads a deterministic world and exposes its HUD', async ({ page }) => {
    await startHarnessWorld(page, 'seedlands-playwright-regression');
    await expect(page.locator('#debug')).toContainText('Seed  seedlands-playwright-regression');
    stages.load = 'PASS';
  });

  test('moves and jumps through the real pointer-lock input path', async ({ page }) => {
    await startHarnessWorld(page, 'seedlands-playwright-regression');
    const before = await snapshot(page);
    expect(before).not.toBeNull();
    await lockPointer(page);
    await setHarnessView(page, 0, 0);
    await page.keyboard.down('KeyW');
    await waitForSnapshot(page, (current) => Math.abs(current.player[2]) > 0.5);
    await page.keyboard.up('KeyW');
    await page.keyboard.press('Space');
    await clickCanvasCenter(page, 'left');
    await waitForSnapshot(page, (current) => current.interactionAttempts === 1);
    stages.input = 'PASS';
    stages.player = 'PASS';
  });

  test('moves across a flat voxel platform without overlapping its floor', async ({ page }) => {
    await startHarnessWorld(page, 'seedlands-player-collision');
    await prepareFlatMovement(page);
    const before = await snapshot(page);
    expect(before).not.toBeNull();
    if (!before) throw new Error('Seedlands harness snapshot is unavailable before flat movement.');
    expect(before.colliding).toBe(false);

    await lockPointer(page);
    await setHarnessView(page, 0, 0);
    await page.keyboard.down('KeyW');
    const after = await waitForPlayerMovement(page, {
      axis: 2,
      start: before.player[2],
      minimumDelta: 3,
    });
    await page.keyboard.up('KeyW');
    expect(after.player[1]).toBeCloseTo(before.player[1], 2);
    expect(after.onGround).toBe(true);
    expect(after.colliding).toBe(false);
  });

  test('keeps real edge support and falls only after all supporting voxels are removed', async ({ page }) => {
    await startHarnessWorld(page, 'seedlands-player-collision');
    await prepareCenterExcavation(page);
    await fillHarnessWorld(page, [-1, 16, -1], [0, 16, 0], Voxel.Stone);
    await fillHarnessWorld(page, [-1, 17, -1], [0, 55, 0], Voxel.Air);
    const supported = await waitForSnapshot(page, (current) => current.onGround && !current.colliding);
    await expect
      .poll(async () => (await snapshot(page))!.authority.physicsTick)
      .toBeGreaterThan(supported.authority.physicsTick + 15);
    const stillSupported = (await snapshot(page))!;
    expect(stillSupported.player[1]).toBeCloseTo(supported.player[1], 4);
    expect(stillSupported.onGround).toBe(true);
    expect(stillSupported.colliding).toBe(false);

    await lockPointer(page);
    await fillHarnessWorld(page, [-1, 56, -1], [0, 56, 0], 0);
    const falling = await waitForAuthorityFall(page, supported);
    expect(falling.onGround).toBe(false);
    expect(falling.colliding).toBe(false);
    await page.keyboard.down('Space');
    try {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const afterSpace = await waitForAuthorityFall(page, falling, true);
      expect(afterSpace.colliding).toBe(false);
      const boundarySample = await page.waitForFunction(
        (tick) => {
          const current = window.__seedlandsHarness!.snapshot();
          return current.trajectory.some((sample) => sample.physicsTick >= tick && sample.position[1] <= 20.6)
            ? current
            : null;
        },
        falling.authority.physicsTick,
        { timeout: 15_000 },
      );
      const reachedBoundary = await boundarySample.jsonValue();
      await boundarySample.dispose();
      if (!reachedBoundary)
        throw new Error('Authority did not descend to the pre-landing boundary while Space was held.');
      const samples = reachedBoundary.trajectory.filter(
        (sample) => sample.physicsTick >= falling.authority.physicsTick,
      );
      expect(samples[0]?.physicsTick).toBe(falling.authority.physicsTick);
      // Stop the airborne window two blocks above the floor: snapshots can skip the exact contact tick.
      const boundaryIndex = samples.findIndex((sample) => sample.position[1] <= 20.6);
      expect(boundaryIndex).toBeGreaterThanOrEqual(0);
      const firstDescent = samples.slice(0, boundaryIndex + 1);
      expect(firstDescent.length).toBeGreaterThanOrEqual(2);
      for (let index = 1; index < firstDescent.length; index += 1)
        expect(firstDescent[index]!.position[1]).toBeLessThanOrEqual(firstDescent[index - 1]!.position[1] + 0.0001);
    } finally {
      await page.keyboard.up('Space');
    }
    const landed = await waitForSnapshot(
      page,
      (current) => current.onGround && Math.abs(current.serverPlayerPosition[1] - 18.6) < 0.001,
    );
    expect(landed.colliding).toBe(false);
    const trajectory = await page.evaluate(() => window.__seedlandsHarness!.snapshot().trajectory);
    const descent = trajectory.filter((sample) => sample.physicsTick >= falling.authority.physicsTick);
    expect(descent.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...descent.map((sample) => sample.position[1]))).toBeGreaterThanOrEqual(18.6 - 0.001);
    const settled = await waitForSnapshot(page, (current) => {
      const recent = current.trajectory.filter((sample) => sample.physicsTick >= current.authority.physicsTick - 15);
      return (
        current.onGround &&
        !current.colliding &&
        recent.length >= 2 &&
        recent[0]!.physicsTick <= current.authority.physicsTick - 14 &&
        recent.every((sample) => Math.abs(sample.position[1] - 18.6) < 0.001)
      );
    });
    expect(settled.serverPlayerPosition[1]).toBeCloseTo(18.6, 3);
    expect(settled.onGround).toBe(true);
    expect(settled.colliding).toBe(false);
  });

  test('walks down a ledge and requires a real jump to return without overlap', async ({ page }) => {
    await startHarnessWorld(page, 'seedlands-player-collision');
    await prepareStepDown(page);
    await fillHarnessWorld(page, [-2, 55, 3], [2, 56, 32], Voxel.Stone);
    const before = await waitForSnapshot(page, (current) => current.onGround && !current.colliding);
    await lockPointer(page);
    await setHarnessView(page, 0, 0);
    await page.keyboard.down('KeyW');
    try {
      await waitForPlayerMovement(page, {
        axis: 2,
        start: before.player[2],
        minimumDelta: 1.5,
        direction: -1,
        yTarget: before.player[1] - 1,
      });
    } finally {
      await page.keyboard.up('KeyW');
    }
    await waitForSnapshot(page, (current) => current.onGround && !current.colliding);
    await page.keyboard.down('KeyS');
    try {
      const blocked = await waitForSnapshot(
        page,
        (current) => current.player[2] > -0.4 && current.player[2] < -0.3 && current.onGround,
      );
      expect(blocked.player[1]).toBeCloseTo(before.player[1] - 1, 2);
      expect(blocked.colliding).toBe(false);
      await page.keyboard.down('Space');
      const returned = await waitForPlayerMovement(page, {
        axis: 2,
        start: blocked.player[2],
        minimumDelta: 0.8,
        direction: 1,
      });
      expect(returned.player[2]).toBeGreaterThan(blocked.player[2] + 0.8);
      expect(returned.colliding).toBe(false);
      await page.keyboard.up('Space');
      await page.keyboard.up('KeyS');
      const landed = await waitForSnapshot(
        page,
        (current) =>
          Math.abs(current.player[1] - 58.6) < 0.15 && current.player[2] >= 0 && current.onGround && !current.colliding,
      );
      await expect
        .poll(async () => (await snapshot(page))!.authority.physicsTick)
        .toBeGreaterThan(landed.authority.physicsTick + 15);
      const stable = (await snapshot(page))!;
      expect(stable.player[1]).toBeCloseTo(before.player[1], 1);
      expect(stable.player[2]).toBeGreaterThanOrEqual(0);
      expect(stable.onGround).toBe(true);
      expect(stable.colliding).toBe(false);
    } finally {
      await page.keyboard.up('Space');
      await page.keyboard.up('KeyS');
    }
  });

  test('persists a controlled world edit through the production edit and Store paths', async ({ page }) => {
    await startHarnessWorld(page, 'seedlands-playwright-regression');
    const initial = await snapshot(page);
    expect(initial).not.toBeNull();
    await removeHarnessVoxel(page, 0, 0, 0);
    await expect.poll(async () => (await snapshot(page))?.mutationCount).toBe(initial!.mutationCount + 1);
    const changed = await waitForSnapshot(page, (current) => current.storageBytes > 0);
    expect(changed.storageBytes).toBeGreaterThan(0);
    stages.interaction = 'PASS';

    await startHarnessWorld(page, 'seedlands-playwright-regression');
    await expect
      .poll(async () => {
        const current = await snapshot(page);
        return (
          current?.mutationCount === 0 &&
          current.serverRevision === changed.serverRevision &&
          current.voxelAtOrigin === 0
        );
      })
      .toBe(true);
    stages.persistence = 'PASS';
  });

  test('updates the streaming center for a controlled chunk-crossing position', async ({ page }) => {
    await startHarnessWorld(page, 'seedlands-playwright-regression');
    await moveHarnessPlayer(page, 40, 34, 0);
    const moved = await waitForSnapshot(page, (current) => current.streamCenter[0] === 1);
    expect(moved.player[0]).toBe(40);
    expect(moved.loadedChunks).toBeGreaterThan(0);
    browserMetrics = { ui: moved.ui, gameplay: moved.gameplay };
    stages.streaming = 'PASS';
  });
});
