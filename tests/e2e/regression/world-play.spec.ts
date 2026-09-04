import { expect, test } from '@playwright/test';
import {
  clickCanvasCenter,
  lockPointer,
  moveHarnessPlayer,
  prepareCenterExcavation,
  prepareFlatMovement,
  prepareStepDown,
  removeHarnessVoxel,
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

test.describe.serial('Seedlands deterministic browser regression', () => {
  test.afterAll(async () => {
    await writeBrowserE2EResult(stages);
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
    await page.keyboard.down('KeyW');
    const after = await waitForPlayerMovement(page, { axis: 2, start: before.player[2], minimumDelta: 3 });
    await page.keyboard.up('KeyW');
    expect(after.player[1]).toBeCloseTo(before.player[1], 2);
    expect(after.onGround).toBe(true);
    expect(after.colliding).toBe(false);
  });

  test('falls when its center ground voxel is excavated despite neighboring support', async ({ page }) => {
    await startHarnessWorld(page, 'seedlands-player-collision');
    await prepareCenterExcavation(page);
    const before = await snapshot(page);
    expect(before).not.toBeNull();
    if (!before) throw new Error('Seedlands harness snapshot is unavailable before center excavation.');

    const falling = await waitForPlayerMovement(page, {
      axis: 1,
      start: before.player[1],
      minimumDelta: 0.25,
      direction: -1,
    });
    expect(falling.onGround).toBe(false);
    await lockPointer(page);
    await page.keyboard.down('Space');
    const afterSpace = await waitForPlayerMovement(page, {
      axis: 1,
      start: falling.player[1],
      minimumDelta: 0.15,
      direction: -1,
    });
    await page.keyboard.up('Space');
    expect(afterSpace.onGround).toBe(false);
  });

  test('steps down from a ledge and can immediately reverse without remaining embedded', async ({ page }) => {
    await startHarnessWorld(page, 'seedlands-player-collision');
    await prepareStepDown(page);
    const before = await snapshot(page);
    expect(before).not.toBeNull();
    if (!before) throw new Error('Seedlands harness snapshot is unavailable before stepping down.');

    await lockPointer(page);
    await page.keyboard.down('KeyW');
    const steppedDown = await waitForPlayerMovement(page, {
      axis: 2,
      start: before.player[2],
      minimumDelta: 0.15,
      direction: -1,
      yTarget: before.player[1] - 1,
    });
    await page.keyboard.up('KeyW');
    await page.keyboard.down('KeyS');
    const reversed = await waitForPlayerMovement(page, {
      axis: 2,
      start: steppedDown.player[2],
      minimumDelta: 0.5,
      direction: 1,
      yTarget: before.player[1] - 1,
    });
    await page.keyboard.up('KeyS');
    expect(reversed.colliding).toBe(false);
  });

  test('persists a controlled world edit through the production edit and Store paths', async ({ page }) => {
    await startHarnessWorld(page, 'seedlands-playwright-regression');
    await removeHarnessVoxel(page, 0, 0, 0);
    await waitForSnapshot(page, (current) => current.mutationCount === 1);
    const changed = await waitForSnapshot(page, (current) => current.storageBytes > 0);
    expect(changed.storageBytes).toBeGreaterThan(0);
    stages.interaction = 'PASS';

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '进入世界' }).click();
    await page.locator('#debug').waitFor({ state: 'visible', timeout: 15_000 });
    await waitForSnapshot(
      page,
      (current) => current.mutationCount === 0 && current.serverRevision === 1 && current.voxelAtOrigin === 0,
    );
    stages.persistence = 'PASS';
  });

  test('updates the streaming center for a controlled chunk-crossing position', async ({ page }) => {
    await startHarnessWorld(page, 'seedlands-playwright-regression');
    await moveHarnessPlayer(page, 40, 34, 0);
    const moved = await waitForSnapshot(page, (current) => current.streamCenter[0] === 1);
    expect(moved.player[0]).toBe(40);
    expect(moved.loadedChunks).toBeGreaterThan(0);
    stages.streaming = 'PASS';
  });
});
