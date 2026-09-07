import { expect, test } from '@playwright/test';
import { Voxel } from '../../../src/world/voxel';
import {
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
    const falling = await waitForPlayerMovement(page, {
      axis: 1,
      start: supported.player[1],
      minimumDelta: 0.25,
      direction: -1,
    });
    expect(falling.onGround).toBe(false);
    expect(falling.colliding).toBe(false);
    await page.keyboard.down('Space');
    try {
      const afterSpace = await waitForPlayerMovement(page, {
        axis: 1,
        start: falling.player[1],
        minimumDelta: 0.15,
        direction: -1,
      });
      expect(afterSpace.onGround).toBe(false);
      expect(afterSpace.colliding).toBe(false);
    } finally {
      await page.keyboard.up('Space');
    }
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
