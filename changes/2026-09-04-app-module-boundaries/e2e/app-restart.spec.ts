import { expect, test } from '@playwright/test';
import { startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

type LifecycleSnapshot = {
  worldInstanceId: number;
  disposedWorlds: number;
  staleVisibleCommits: number;
};

type RestartHarnessWindow = Window & {
  __seedlandsHarness?: {
    restartWorld: (seed: string) => Promise<void>;
    lifecycleSnapshot: () => LifecycleSnapshot;
  };
};

const lifecycleSnapshot = async (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const harness = (window as RestartHarnessWindow).__seedlandsHarness;
    if (!harness) throw new Error('Seedlands restart harness is unavailable.');
    return harness.lifecycleSnapshot();
  });

test('restarts a world on the same page without stale commits from the disposed world', async ({ page }) => {
  await startHarnessWorld(page, 'app-module-first-world');
  const before = await lifecycleSnapshot(page);

  await page.evaluate(async () => {
    const harness = (window as RestartHarnessWindow).__seedlandsHarness;
    if (!harness) throw new Error('Seedlands restart harness is unavailable.');
    await harness.restartWorld('app-module-second-world');
  });

  await expect(page.locator('#debug')).toContainText('Seed  app-module-second-world');
  await waitForSnapshot(page, (snapshot) => snapshot.loadedChunks > 0);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  const after = await lifecycleSnapshot(page);

  expect(after.worldInstanceId).not.toBe(before.worldInstanceId);
  expect(after.disposedWorlds).toBe(before.disposedWorlds + 1);
  expect(after.staleVisibleCommits).toBe(0);
});
