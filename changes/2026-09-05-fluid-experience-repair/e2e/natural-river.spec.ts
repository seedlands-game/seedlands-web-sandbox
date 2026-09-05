import { expect, test } from '@playwright/test';
import { lockPointer, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test('v3 自然河岸可涉入、游泳、上浮、下潜并从对岸离水', async ({ page }) => {
  await startHarnessWorld(page, 'mosslight-68');
  const crossSection = await page.evaluate(() => {
    const harness = window.__seedlandsHarness!;
    harness.movePlayerTo(30.5, 13.6, -30.5);
    harness.setView(0, 0);
    return {
      bank: harness.getVoxelAt?.(30, 11, -31),
      waterTopCell: harness.getVoxelAt?.(31, 11, -32),
      bed: harness.getVoxelAt?.(31, 9, -32),
      version: harness.snapshot().generatorVersion,
    };
  });
  expect(crossSection).toEqual({ bank: 1, waterTopCell: 8, bed: 1, version: 3 });
  await waitForSnapshot(
    page,
    (state) =>
      state.generationQueue === 0 &&
      state.meshingQueue === 0 &&
      state.deferredRemeshes === 0 &&
      state.performance.uploadQueueDepth === 0,
  );
  await page.screenshot({
    path: 'changes/2026-09-05-fluid-experience-repair/evidence/natural-river-bank.png',
  });

  await lockPointer(page);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  await waitForSnapshot(page, (state) => state.water.wading && state.player[0] > 31 && state.player[2] < -32);
  const swimming = await waitForSnapshot(page, (state) => state.water.swimming);
  expect(swimming.colliding).toBe(false);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyD');
  await page.keyboard.down('ShiftLeft');
  await waitForSnapshot(page, (state) => state.water.cameraSubmerged && state.water.underwaterBlend > 0.75);
  await page.keyboard.up('ShiftLeft');
  await page.screenshot({
    path: 'changes/2026-09-05-fluid-experience-repair/evidence/natural-river-underwater.png',
  });
  const filterInWater = await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & { __seedlandsAudio?: { snapshot: () => { underwaterFilterHz?: number } } }
          ).__seedlandsAudio?.snapshot().underwaterFilterHz ?? 18_000,
      ),
    )
    .toBeLessThan(8_000);
  void filterInWater;

  const beforeRise = (await page.evaluate(() => window.__seedlandsHarness!.snapshot().player[1])) ?? 0;
  await page.keyboard.down('Space');
  await expect
    .poll(() => page.evaluate(() => window.__seedlandsHarness!.snapshot().player[1]))
    .toBeGreaterThan(beforeRise + 0.06);
  await page.keyboard.up('Space');
  const beforeDive = await page.evaluate(() => window.__seedlandsHarness!.snapshot().player[1]);
  await page.keyboard.down('ShiftLeft');
  await expect
    .poll(() => page.evaluate(() => window.__seedlandsHarness!.snapshot().player[1]))
    .toBeLessThan(beforeDive - 0.06);
  await page.keyboard.up('ShiftLeft');

  const waterSoundsBeforePause = await page.evaluate(
    () =>
      (
        window as Window & { __seedlandsAudio?: { snapshot: () => { playedCount: number } } }
      ).__seedlandsAudio?.snapshot().playedCount ?? 0,
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '暂停游戏' })).toBeVisible();
  await page.waitForTimeout(450);
  expect(
    await page.evaluate(
      () =>
        (
          window as Window & { __seedlandsAudio?: { snapshot: () => { playedCount: number } } }
        ).__seedlandsAudio?.snapshot().playedCount ?? 0,
    ),
  ).toBe(waterSoundsBeforePause);
  await page.getByRole('button', { name: '继续游戏' }).click();
  await lockPointer(page);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  await page.keyboard.down('Space');
  const dry = await waitForSnapshot(
    page,
    (state) =>
      !state.water.wading &&
      !state.water.swimming &&
      !state.water.cameraSubmerged &&
      state.player[0] > 38 &&
      state.onGround,
  );
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyD');
  await page.keyboard.up('Space');
  expect(dry.onGround).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & { __seedlandsAudio?: { snapshot: () => { underwaterFilterHz?: number } } }
          ).__seedlandsAudio?.snapshot().underwaterFilterHz ?? 0,
      ),
    )
    .toBeGreaterThan(12_000);

  await page.evaluate(() => window.__seedlandsHarness!.movePlayerTo(32.5, 10.25, -33.5));
  await waitForSnapshot(page, (state) => state.water.cameraSubmerged && state.water.underwaterBlend > 0.75);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & { __seedlandsAudio?: { snapshot: () => { underwaterFilterHz?: number } } }
          ).__seedlandsAudio?.snapshot().underwaterFilterHz ?? 18_000,
      ),
    )
    .toBeLessThan(8_000);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '保存并返回主菜单' }).click();
  await expect(page.locator('#start-card')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & { __seedlandsAudio?: { snapshot: () => { underwaterFilterHz?: number } } }
          ).__seedlandsAudio?.snapshot().underwaterFilterHz ?? 18_000,
      ),
    )
    .toBeGreaterThan(12_000);
  await startHarnessWorld(page, 'post-water-switch');
  const switched = await waitForSnapshot(page, (state) => state.generatorVersion === 3 && !state.water.cameraSubmerged);
  expect(switched.water.underwaterBlend).toBe(0);
});

test('同名 seed 可明确继续 v2，也可保留旧档进入 v3', async ({ page }) => {
  const seed = 'version-entry-river';
  await page.goto('./?harness=1', { waitUntil: 'networkidle' });
  await page.evaluate(async (seedText) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('seedlands-chunks-v1', 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('worlds')) database.createObjectStore('worlds', { keyPath: 'worldId' });
        if (!database.objectStoreNames.contains('chunks'))
          database.createObjectStore('chunks', { keyPath: ['worldId', 'cx', 'cy', 'cz'] });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('worlds', 'readwrite');
        transaction.objectStore('worlds').put({
          worldId: `seedlands:g2:${seedText}`,
          seedText,
          generatorVersion: 2,
          player: null,
          updatedAt: Date.now(),
        });
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, seed);
  await page.locator('#seed').fill(seed);
  await page.locator('#world-version-mode').selectOption('continue-legacy');
  await page.getByRole('button', { name: '进入世界' }).click();
  await expect.poll(() => page.evaluate(() => window.__seedlandsHarness?.snapshot().generatorVersion)).toBe(2);
  await page.evaluate(async () => {
    window.__seedlandsHarness!.setVoxelAt(0, 40, 0, 4);
    await window.__seedlandsHarness!.flushSave();
  });
  await page.getByRole('button', { name: '暂停游戏' }).click();
  await page.getByRole('button', { name: '保存并返回主菜单' }).click();
  await expect(page.locator('#start-card')).toBeVisible();

  await page.locator('#seed').fill(seed);
  await page.locator('#world-version-mode').selectOption('new-current');
  await page.getByRole('button', { name: '进入世界' }).click();
  await expect.poll(() => page.evaluate(() => window.__seedlandsHarness?.snapshot().generatorVersion)).toBe(3);
  expect(await page.evaluate(() => window.__seedlandsHarness!.getVoxelAt?.(0, 40, 0))).not.toBe(4);
  const versions = await page.evaluate(async (seedText) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('seedlands-chunks-v1', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('worlds', 'readonly');
    const records = await new Promise<Array<{ seedText: string; generatorVersion: number }>>((resolve, reject) => {
      const request = transaction.objectStore('worlds').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return records
      .filter((record) => record.seedText === seedText)
      .map((record) => record.generatorVersion)
      .sort();
  }, seed);
  expect(versions).toEqual([2, 3]);
});
