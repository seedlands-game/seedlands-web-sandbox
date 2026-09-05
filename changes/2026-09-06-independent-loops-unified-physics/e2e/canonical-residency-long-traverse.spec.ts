import { expect, test } from '@playwright/test';
import { startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';
import { Voxel } from '../../../src/world/voxel';

const SEED = 'authority-canonical-long-traverse';
const EDIT = { x: 0, y: 63, z: 0, voxel: Voxel.Lantern } as const;
const CENTERS = [0, 6, 12, 18, 24, 30] as const;

test('跨300个Chunk往返时canonical驻留收敛，编辑经原子保存与重载不丢失', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await startHarnessWorld(page, SEED, '&generalWorkers=2');

  await page.evaluate(async ({ x, y, z, voxel }) => await window.__seedlandsHarness!.setVoxelAt(x, y, z, voxel), EDIT);
  await expect
    .poll(() => page.evaluate(({ x, y, z }) => window.__seedlandsHarness!.getVoxelAt?.(x, y, z), EDIT))
    .toBe(Voxel.Lantern);

  const traversal: Array<{
    center: number;
    residentCount: number;
    pinnedCount: number;
    dirtyCount: number;
    evictionCount: number;
    rejectedAdmissionCount: number;
  }> = [];
  for (const center of CENTERS) {
    const x = center * 32 + 0.5;
    await page.evaluate(async (targetX) => await window.__seedlandsHarness!.movePlayerTo(targetX, 62.6, 0.5), x);
    await page.waitForFunction(
      (targetCenter) => {
        const snapshot = window.__seedlandsHarness?.snapshot();
        return (
          snapshot?.streamCenter[0] === targetCenter &&
          snapshot.renderedChunks > 0 &&
          snapshot.generationQueue === 0 &&
          snapshot.meshingQueue === 0 &&
          snapshot.authority.residency !== null
        );
      },
      center,
      { timeout: 30_000 },
    );
    const settled = await page.evaluate(() => window.__seedlandsHarness!.snapshot());
    traversal.push({ center, ...settled.authority.residency! });
  }

  await page.waitForFunction(
    () => {
      const snapshot = window.__seedlandsHarness?.snapshot();
      return (
        snapshot?.streamCenter[0] === 30 &&
        snapshot.authority.residency !== null &&
        snapshot.authority.residency.residentCount <= snapshot.authority.residency.target
      );
    },
    undefined,
    { timeout: 30_000 },
  );
  const furthest = await page.evaluate(() => window.__seedlandsHarness!.snapshot());
  expect(furthest.authority.residency!.evictionCount).toBeGreaterThan(0);
  expect(furthest.authority.residency!.rejectedAdmissionCount).toBe(0);
  expect(furthest.authority.residency!.lastSaveError).toBeNull();

  await page.evaluate(async () => await window.__seedlandsHarness!.movePlayerTo(0.5, 62.6, 0.5));
  await waitForSnapshot(
    page,
    (snapshot) => snapshot.streamCenter[0] === 0 && snapshot.generationQueue === 0 && snapshot.meshingQueue === 0,
  );
  await expect
    .poll(() => page.evaluate(({ x, y, z }) => window.__seedlandsHarness!.getVoxelAt?.(x, y, z), EDIT))
    .toBe(Voxel.Lantern);
  await page.evaluate(async () => await window.__seedlandsHarness!.flushSave());

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '进入世界' }).click();
  await page.locator('#start-card').waitFor({ state: 'hidden' });
  const restored = await waitForSnapshot(
    page,
    (snapshot) => snapshot.loadedChunks > 0 && snapshot.authority.residency !== null,
  );
  const restoredVoxel = await page.evaluate(({ x, y, z }) => window.__seedlandsHarness!.getVoxelAt?.(x, y, z), EDIT);

  await testInfo.attach('canonical-residency-long-traverse', {
    body: JSON.stringify(
      {
        seed: SEED,
        visitedChunkCenters: CENTERS,
        distinctRequestedChunksAtMedium: CENTERS.length * 5 * 5 * 2,
        traversal,
        furthest: furthest.authority.residency,
        restored: restored.authority.residency,
        restoredVoxel,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(restoredVoxel).toBe(Voxel.Lantern);
  expect(restored.authority.residency!.residentCount).toBeLessThanOrEqual(
    Math.max(restored.authority.residency!.target, restored.authority.residency!.pinnedCount),
  );
});
