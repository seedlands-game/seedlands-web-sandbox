import { expect, test } from '@playwright/test';

for (const { version, storedVersions } of [
  { version: 2, storedVersions: [2, 3, 4] },
  { version: 3, storedVersions: [2, 3, 4] },
  { version: 4, storedVersions: [2, 3, 4] },
  { version: 2, storedVersions: [3, 4] },
]) {
  const exists = storedVersions.includes(version);
  test(
    exists ? `同 Seed 多版存档经真实入口打开并仅保存 v${version}` : `指定 v${version} 缺失时明确失败且不改其他存档`,
    async ({ page }) => {
      test.setTimeout(90_000);
      await page.goto('./?harness=1', { waitUntil: 'networkidle' });
      const original = await page.evaluate(async (versions) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('seedlands-chunks-v1', 1);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'worldId' });
            if (!db.objectStoreNames.contains('chunks'))
              db.createObjectStore('chunks', { keyPath: ['worldId', 'cx', 'cy', 'cz'] });
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const records = versions.map((generatorVersion) => ({
          worldId: `seedlands:g${generatorVersion}:version-coexist`,
          seedText: 'version-coexist',
          generatorVersion,
          player: null,
          updatedAt: generatorVersion,
        }));
        const tx = db.transaction('worlds', 'readwrite');
        const done = new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
        for (const record of records) tx.objectStore('worlds').put(record);
        await done;
        db.close();
        return records;
      }, storedVersions);
      await page.locator('#quality').selectOption('low');
      await page.locator('#seed').fill('version-coexist');
      await page.locator('#world-version-mode').selectOption({
        label: version === 4 ? '新建或进入新版 v4（保留旧档）' : `明确继续旧版 v${version}`,
      });
      await page.getByRole('button', { name: '进入世界' }).click();
      const warning = page.getByRole('button', { name: '仍然进入' });
      if (await warning.isVisible()) await warning.click();
      if (exists) {
        await expect(page.locator('#hud')).toBeVisible({ timeout: 30_000 });
        const selected = await page.evaluate(async () => {
          const harness = window.__seedlandsHarness!;
          await harness.flushSave();
          return harness.snapshot().generatorVersion;
        });
        expect(selected).toBe(version);
      } else {
        await expect(page.getByRole('alert')).toContainText(`没有可继续的 v${version} 世界`, { timeout: 30_000 });
        await expect(page.locator('#hud')).not.toBeVisible();
      }
      const stored = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('seedlands-chunks-v1', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const records = await new Promise<{ worldId: string; generatorVersion: number; updatedAt: number }[]>(
          (resolve, reject) => {
            const request = db.transaction('worlds', 'readonly').objectStore('worlds').getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          },
        );
        db.close();
        return records;
      });
      expect(stored).toHaveLength(storedVersions.length);
      if (!exists) {
        expect(stored).toEqual(original);
        return;
      }
      expect(stored.find((record) => record.generatorVersion === version)).toMatchObject({
        worldId: `seedlands:g${version}:version-coexist`,
        generatorVersion: version,
      });
      expect(stored.find((record) => record.generatorVersion === version)!.updatedAt).toBeGreaterThan(4);
      expect(stored.filter((record) => record.generatorVersion !== version)).toEqual(
        original.filter((record) => record.generatorVersion !== version),
      );
    },
  );
}
