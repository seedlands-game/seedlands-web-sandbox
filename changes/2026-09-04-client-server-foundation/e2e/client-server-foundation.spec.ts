import { expect, test } from '@playwright/test';
import { removeHarnessVoxel, snapshot, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test('runs the browser through integrated server authority and preserves a server revision after reload', async ({
  page,
}) => {
  await startHarnessWorld(page, 'client-server-foundation');
  const before = await snapshot(page);
  expect(before?.runtime).toBe('integrated-server');
  expect(before?.serverRevision).toBe(0);

  await removeHarnessVoxel(page, 0, 0, 0);
  const changed = await waitForSnapshot(page, (current) => current.serverRevision === 1);
  expect(changed.voxelAtOrigin).toBe(0);
  expect(changed.player).toEqual(changed.serverPlayerPosition);
  expect(changed.worldTime).toBeCloseTo(changed.serverWorldTime);
  await waitForSnapshot(page, (current) => current.storageBytes > 0);

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '进入世界' }).click();
  await page.locator('#debug').waitFor({ state: 'visible', timeout: 15_000 });
  const restored = await waitForSnapshot(page, (current) => current.runtime === 'integrated-server');
  expect(restored.voxelAtOrigin).toBe(0);
  expect(restored.player).toEqual(restored.serverPlayerPosition);
  expect(restored.worldTime).toBeCloseTo(restored.serverWorldTime);
});
