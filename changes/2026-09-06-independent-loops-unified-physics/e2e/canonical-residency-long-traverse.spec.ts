import { expect, test, type Page } from '@playwright/test';
import { startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';
import { GENERATOR_VERSION, Voxel } from '../../../src/world/voxel';

const SEED = 'authority-canonical-long-traverse';
const EDIT = { x: 0, y: 63, z: 0, voxel: Voxel.Lantern } as const;
const CENTERS = [0, 6, 12, 18, 24, 30] as const;

const readStoredEditChunk = (page: Page) =>
  page.evaluate(
    async ({ worldId, cx, cy, cz }) => {
      const opened = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('seedlands-chunks-v1');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed.'));
      });
      try {
        const transaction = opened.transaction('chunks', 'readonly');
        const request = transaction.objectStore('chunks').get([worldId, cx, cy, cz]);
        const record = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
          request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed.'));
        });
        return record
          ? {
              status: 'found' as const,
              worldId: record.worldId,
              cx: record.cx,
              cy: record.cy,
              cz: record.cz,
              revision: record.revision,
              codec: record.codec,
              payloadBytes: record.payloadBytes,
              payloadChecksum: record.payloadChecksum,
            }
          : { status: 'missing' as const };
      } finally {
        opened.close();
      }
    },
    { worldId: `seedlands:g${GENERATOR_VERSION}:${SEED}`, cx: 0, cy: 1, cz: 0 },
  );

test('跨300个Chunk往返时canonical驻留收敛，编辑经原子保存与重载不丢失', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await startHarnessWorld(page, SEED, '&generalWorkers=2');

  await page.evaluate(async ({ x, y, z, voxel }) => await window.__seedlandsHarness!.setVoxelAt(x, y, z, voxel), EDIT);
  await expect
    .poll(() => page.evaluate(({ x, y, z }) => window.__seedlandsHarness!.getVoxelAt?.(x, y, z), EDIT))
    .toBe(Voxel.Lantern);
  await page.evaluate(async () => await window.__seedlandsHarness!.flushSave());
  const storedBeforeTraverse = await readStoredEditChunk(page);
  expect(storedBeforeTraverse).toMatchObject({ status: 'found', revision: 1 });

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
  const storedAtFurthest = await readStoredEditChunk(page);
  expect(storedAtFurthest).toMatchObject({ status: 'found', revision: 1 });
  expect(furthest.authority.residency!.evictionCount).toBeGreaterThan(0);
  expect(furthest.authority.residency!.rejectedAdmissionCount).toBe(0);
  expect(furthest.authority.residency!.lastSaveError).toBeNull();

  await page.evaluate(async () => await window.__seedlandsHarness!.movePlayerTo(0.5, 62.6, 0.5));
  await waitForSnapshot(
    page,
    (snapshot) => snapshot.streamCenter[0] === 0 && snapshot.generationQueue === 0 && snapshot.meshingQueue === 0,
  );
  const returned = await page.evaluate(() => window.__seedlandsHarness!.snapshot());
  const localVoxelBeforeAuthorityRead = await page.evaluate(
    ({ x, y, z }) => window.__seedlandsHarness!.getVoxelAt?.(x, y, z),
    EDIT,
  );
  const localRevisionBeforeAuthorityRead = await page.evaluate(() =>
    window.__seedlandsHarness!.getChunkRevision?.(0, 1, 0),
  );
  const authorityRead = await page.evaluate(
    async ({ x, y, z }) =>
      await window.__seedlandsHarness!.executeGameplayCommand({ type: 'inspect-voxel', position: [x, y, z] }),
    EDIT,
  );
  const authorityVoxel = authorityRead.success
    ? (authorityRead.data as { voxel?: unknown } | undefined)?.voxel
    : undefined;
  const storedAfterReturn = await readStoredEditChunk(page);
  expect(storedAfterReturn).toMatchObject({ status: 'found', revision: 1 });
  await testInfo.attach('canonical-residency-return-diagnostic', {
    body: JSON.stringify(
      {
        seed: SEED,
        traversal,
        storedBeforeTraverse,
        storedAtFurthest,
        storedAfterReturn,
        furthest: furthest.authority.residency,
        returned: returned.authority.residency,
        returnedWorldRevision: returned.worldRevision,
        returnedCommitSequence: returned.authority.commitSequence,
        localVoxelBeforeAuthorityRead,
        localRevisionBeforeAuthorityRead,
        authorityRead,
        authorityVoxel,
        generationQueue: returned.generationQueue,
        meshingQueue: returned.meshingQueue,
        compute: returned.compute,
        storageBytes: returned.storageBytes,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(authorityRead.success).toBe(true);
  expect(authorityVoxel).toBe(Voxel.Lantern);
  await expect
    .poll(() => page.evaluate(({ x, y, z }) => window.__seedlandsHarness!.getVoxelAt?.(x, y, z), EDIT))
    .toBe(Voxel.Lantern);
  await page.evaluate(async () => await window.__seedlandsHarness!.flushSave());

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '进入世界' }).click();
  await page.locator('#start-card').waitFor({ state: 'hidden' });
  const restored = await waitForSnapshot(
    page,
    (snapshot) =>
      snapshot.loadedChunks > 0 &&
      snapshot.streamCenter[0] === 0 &&
      snapshot.generationQueue === 0 &&
      snapshot.meshingQueue === 0 &&
      snapshot.authority.residency !== null,
  );
  const storedAfterReload = await readStoredEditChunk(page);
  const restoredAuthorityRead = await page.evaluate(
    async ({ x, y, z }) =>
      await window.__seedlandsHarness!.executeGameplayCommand({ type: 'inspect-voxel', position: [x, y, z] }),
    EDIT,
  );
  const restoredAuthorityVoxel = restoredAuthorityRead.success
    ? (restoredAuthorityRead.data as { voxel?: unknown } | undefined)?.voxel
    : undefined;
  expect(restoredAuthorityRead.success).toBe(true);
  expect(restoredAuthorityVoxel).toBe(Voxel.Lantern);
  await expect
    .poll(() => page.evaluate(({ x, y, z }) => window.__seedlandsHarness!.getVoxelAt?.(x, y, z), EDIT))
    .toBe(Voxel.Lantern);
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
        restoredAuthorityRead,
        restoredAuthorityVoxel,
        restoredVoxel,
        storedAfterReload,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(restoredVoxel).toBe(Voxel.Lantern);
  expect(storedAfterReload).toMatchObject({ status: 'found', revision: 1 });
  expect(restored.authority.residency!.residentCount).toBeLessThanOrEqual(
    Math.max(restored.authority.residency!.target, restored.authority.residency!.pinnedCount),
  );
});
