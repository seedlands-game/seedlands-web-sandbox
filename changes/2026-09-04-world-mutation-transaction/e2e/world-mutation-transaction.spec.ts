import { expect, test } from '@playwright/test';
import { fillHarnessWorld, snapshot, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test('commits a 100k fill once and schedules one aggregated client remesh', async ({ page }) => {
  await startHarnessWorld(page, 'world-mutation-transaction');
  const before = await snapshot(page);
  expect(before).not.toBeNull();

  await fillHarnessWorld(page, [0, -10, 0], [99, -1, 99], 4);
  const after = await waitForSnapshot(page, (current) => current.structuralEventCount === 1);

  expect(after.worldRevision).toBe((before?.worldRevision ?? 0) + 1);
  expect(after.lastCommitMutationCount).toBe(100_000);
  expect(after.remeshSchedulingCount).toBe(1);
  expect(after.lastCommitMeshChunkCount).toBeLessThan(100_000);
  expect(after.lastCommitMeshChunkCount).toBeGreaterThan(0);
});
