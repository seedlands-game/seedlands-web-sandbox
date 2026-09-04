import { expect, test } from '@playwright/test';
import {
  runChunkPersistenceLoadScenario,
  seedChunkPersistenceCorpus,
  startChunkPersistenceHarness,
} from '../../../tests/e2e/support/chunk-persistence-harness';
import { GENERATOR_VERSION, Voxel } from '../../../src/world/voxel';

test('stores low and high Chunk loads compactly and decodes only the active working set', async ({ page }) => {
  test.setTimeout(180_000);
  await startChunkPersistenceHarness(page);
  const lowSeed = await seedChunkPersistenceCorpus(page, { name: 'low', chunkCount: 8 });
  const low = await runChunkPersistenceLoadScenario(page, { database: lowSeed.database, activeChunkCount: 8 });
  expect(low.storedChunkCount).toBe(8);
  expect(low.recordBytes).toBeLessThanOrEqual(low.rawBytes * 0.1);
  expect(low.recordBytes).toBeLessThan(low.legacyJsonBytes);
  expect(low.decodedChunkCount).toBe(8);
  expect(low.idbGetCount).toBe(8);
  expect(low.codecLane).toBe('persistence-worker');

  const highSeed = await seedChunkPersistenceCorpus(page, { name: 'high', chunkCount: 1_024 });
  const high = await runChunkPersistenceLoadScenario(page, { database: highSeed.database, activeChunkCount: 8 });
  expect(high.storedChunkCount).toBe(1_024);
  expect(high.recordBytes).toBeLessThanOrEqual(high.rawBytes * 0.3);
  expect(high.recordBytes).toBeLessThan(high.legacyJsonBytes);
  expect(high.startupChunkScanCount).toBe(0);
  expect(high.decodedChunkCount).toBe(8);
  expect(high.idbGetCount).toBe(8);
  expect(high.residentChunkCount).toBeLessThanOrEqual(high.residentLimit + high.inFlightChunkCount);
  expect(high.codecLane).toBe('persistence-worker');
  expect(high.decodeP50Ms).toBeLessThanOrEqual(low.decodeP50Ms * 2);
  expect(high.decodeP95Ms).toBeLessThanOrEqual(low.decodeP95Ms * 2.5);
  expect(high.storageEstimate).toMatchObject({ usage: expect.any(Number), quota: expect.any(Number) });

  const incremental = await high.saveOneChangedChunk();
  console.log(
    `CHUNK_PERSISTENCE_BROWSER ${JSON.stringify({ low, high: { ...high, saveOneChangedChunk: undefined }, incremental })}`,
  );
  expect(incremental.encodedChunkCount).toBe(1);
  expect(incremental.idbPutCount).toBe(1);
  expect(incremental.untouchedChunkReadCount).toBe(0);
});

test('migrates legacy localStorage once, verifies it through IndexedDB and keeps the source intact', async ({
  page,
}) => {
  const seedText = 'legacy-indexeddb-migration';
  const voxels = new Array<number>(32 ** 3).fill(Voxel.Air);
  voxels[0] = Voxel.Wood;
  await page.goto('/?harness=1', { waitUntil: 'networkidle' });
  await page.evaluate(
    ({ seed, generatorVersion, savedVoxels }) => {
      localStorage.setItem(
        'seedlands-world-v2',
        JSON.stringify({
          seed,
          generatorVersion,
          player: [0, 34, 0],
          snapshots: [
            {
              key: '0,0,0',
              seedText: seed,
              cx: 0,
              cy: 0,
              cz: 0,
              generatorVersion,
              revision: 1,
              voxels: savedVoxels,
            },
          ],
        }),
      );
    },
    { seed: seedText, generatorVersion: GENERATOR_VERSION, savedVoxels: voxels },
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '进入世界' }).click();
  await page.waitForFunction((wood) => {
    const snapshot = window.__seedlandsHarness?.snapshot();
    return snapshot?.mutationCount === 1 && snapshot.voxelAtOrigin === wood;
  }, Voxel.Wood);
  expect(await page.evaluate(() => localStorage.getItem('seedlands-world-v2'))).not.toBeNull();

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '进入世界' }).click();
  await page.waitForFunction(() => window.__seedlandsHarness?.snapshot().mutationCount === 1);
  expect(await page.evaluate(() => localStorage.getItem('seedlands-world-v2'))).not.toBeNull();
});
