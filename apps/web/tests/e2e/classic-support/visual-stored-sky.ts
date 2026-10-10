import { expect, type Page, type TestInfo } from '@playwright/test';
import { type ClassicWindow } from './harness';
import { classicScenario } from './scenario';
import { startClassicWorld } from './start';
import type { WorldInspectResult } from '@seedlands/stdlib/server/harness/world-harness-contract';

const observeStoredRoof = (page: Page) =>
  page.evaluate(async () => {
    const h = (window as unknown as ClassicWindow).__seedlandsHarness!;
    const identity = await h.world.identity();
    const inspection = await h.world.inspect({ kind: 'column-source', column: [0, 0] });
    if (!identity.ok) throw new Error(identity.error.message);
    if (!inspection.ok) throw new Error(inspection.error.message);
    const data = inspection.data as Extract<WorldInspectResult, { kind: 'column-source' }>;
    if (data.kind !== 'column-source' || data.source.status !== 'complete')
      throw new Error('Saved roof column source is not complete.');
    return {
      worldId: identity.data.worldId,
      epoch: identity.data.epoch,
      source: data.source,
      roof: data.source.entries.find((entry) => entry.key === '0,7,0'),
      canonicalRevision: h.getChunkRevision?.(0, 7, 0),
      sky: h.skyVisibilityDiagnostics(),
    };
  });

/** Cold read through the production persistence Worker, inside the sole visual journey. */
export async function verifyStoredSkyAfterReload(page: Page, testInfo: TestInfo): Promise<void> {
  await page.evaluate(async () => {
    const h = (window as unknown as ClassicWindow).__seedlandsHarness!;
    const roof = await h.setVoxelAt(0, 226, 0, 3);
    if (!roof || roof.reason) throw new Error('Saved high roof fixture edit failed.');
    await h.flushSave();
  });
  const saved = await observeStoredRoof(page);
  expect(saved.roof?.revision).toBeGreaterThan(0);
  await startClassicWorld(page, { ...classicScenario, seed: 'classic-visual-v3', quality: 'low' });
  const cold = await observeStoredRoof(page);
  expect(cold.worldId).toBe(saved.worldId);
  expect(cold.roof).toMatchObject({ key: '0,7,0', revision: saved.roof!.revision, resident: false, dirty: false });
  expect(cold.canonicalRevision).toBeNull();
  try {
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as unknown as ClassicWindow)
                .__seedlandsHarness!.skyVisibilityDiagnostics()
                ?.readyChunkKeys.includes('0,1,0') ?? false,
          ),
        { timeout: 20_000 },
      )
      .toBe(true);
  } finally {
    await testInfo.attach('cold-stored-sky-source.json', {
      contentType: 'application/json',
      body: JSON.stringify({ saved, cold, after: await observeStoredRoof(page) }),
    });
  }
  const after = await observeStoredRoof(page);
  expect(after.roof).toMatchObject({ revision: saved.roof!.revision, resident: false, dirty: false });
  expect(after.canonicalRevision).toBeNull();
  await testInfo.attach('cold-stored-sky-scene', { contentType: 'image/png', body: await page.screenshot() });
}
