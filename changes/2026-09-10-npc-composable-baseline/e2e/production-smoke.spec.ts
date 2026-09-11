import { expect, test } from '@playwright/test';
import { lockPointer, snapshot, waitForPlayerMovement } from '../../../tests/e2e/support/harness';
import { lifeSample, startLifeScene } from './support';

test('生产产物的 Pack 与 Worker 支持伙伴生活、检查点恢复及真实输入', async ({ page }, testInfo) => {
  test.skip(process.env.SEEDLANDS_E2E_PRODUCTION !== '1', '仅由 production preview 入口执行，不把 dev 当生产证据');
  test.setTimeout(120000);
  const errors: string[] = [];
  const workers: string[] = [];
  const assets: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('worker', (worker) => workers.push(new URL(worker.url()).pathname));
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (/\.(?:js|mjs|wasm)$/.test(path)) {
      assets.push(path);
      if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${path}`);
    }
  });
  const character = await startLifeScene(page);
  await expect
    .poll(
      async () => {
        const sample = await lifeSample(page, character.entityId, 0);
        return sample.observation.events.some(
          (event) => event.type === 'activity-succeeded' && event.nodeId === 'hunger-action',
        );
      },
      { timeout: 60000 },
    )
    .toBe(true);
  await page.evaluate(() => window.__seedlandsHarness!.world.clock({ kind: 'pause' }));
  const before = await lifeSample(page, character.entityId, 0);
  const restored = await page.evaluate(async () => {
    const world = window.__seedlandsHarness!.world;
    const exported = await world.checkpoint({ kind: 'export' });
    if (!exported.ok || !exported.data.snapshot) throw new Error('Production checkpoint export failed');
    return world.checkpoint({ kind: 'restore', snapshot: exported.data.snapshot });
  });
  expect(restored).toMatchObject({ ok: true });
  const after = await lifeSample(page, character.entityId, 0);
  expect(after.observation.character.inventory).toEqual(before.observation.character.inventory);
  expect(after.observation.character.hunger).toBe(before.observation.character.hunger);
  expect(after.observation.character.behaviorTree.definition).toEqual(
    before.observation.character.behaviorTree.definition,
  );
  expect(after.paused).toBe(true);
  await page.evaluate(async () => {
    const harness = window.__seedlandsHarness!;
    harness.setView(0, 0);
    const running = await harness.world.clock({ kind: 'run' });
    if (!running.ok) throw new Error('Production world cannot resume');
  });
  if (await page.locator('#companion').isVisible()) await page.keyboard.press('KeyT');
  const start = await snapshot(page);
  expect(start).not.toBeNull();
  await lockPointer(page);
  await page.keyboard.down('KeyW');
  try {
    await waitForPlayerMovement(page, { axis: 2, start: start!.player[2], minimumDelta: 0.5 });
  } finally {
    await page.keyboard.up('KeyW');
  }
  expect(workers.some((path) => /authority-worker-[\w-]+\.js$/.test(path))).toBe(true);
  expect(assets.some((path) => path.endsWith('/overworld.mjs'))).toBe(true);
  expect(assets.some((path) => path.includes('/src/'))).toBe(false);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('production-resumed-world.png') });
  await testInfo.attach('production-entry-evidence', {
    body: JSON.stringify({ workers, assets, before, after, errors }),
    contentType: 'application/json',
  });
});
