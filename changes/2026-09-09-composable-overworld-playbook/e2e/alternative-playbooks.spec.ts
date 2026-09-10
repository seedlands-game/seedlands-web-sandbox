import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HeadlessSession } from '../../../packages/game-core/src/server/headless/headless-session';
import type { FrozenGameSaveSnapshot } from '../../../packages/game-core/src/server/persistence/game-save-snapshot';
import { assembleProductPacks, type VerifiedPackArtifact } from '@seedlands/game-core/server/composition/host-api';
import { testCorePlatform } from '../../../tests/support/core-platform';
import { startHarnessWorld, lockPointer, moveHarnessPlayer, setHarnessView } from '../../../tests/e2e/support/harness';

async function example(page: Page, playbook: 'click-conversion' | 'builder') {
  const output = await mkdtemp(join(tmpdir(), `seedlands-${playbook}-`));
  const build = (await import(pathToFileURL(resolve('scripts/build-gameplay-packs.mjs')).href)) as {
    buildGameplayPacks(path: string, playbook: string): Promise<{ lockPath: string }>;
  };
  const loader = (await import(pathToFileURL(resolve('scripts/pack-integrity.mjs')).href)) as {
    loadVerifiedPackArtifacts(path: string): Promise<readonly VerifiedPackArtifact[]>;
  };
  try {
    const { lockPath } = await build.buildGameplayPacks(output, playbook);
    const artifacts = await loader.loadVerifiedPackArtifacts(lockPath);
    const files = new Map(
      await Promise.all(
        ['packs.lock.json', 'host-admissions.json', `${playbook}.manifest.json`, `${playbook}.mjs`].map(
          async (name) => [name, await readFile(join(output, name))] as const,
        ),
      ),
    );
    await page.route('**/packs/*', async (route) => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1)!;
      const bytes = files.get(name);
      if (!bytes) throw new Error(`Unexpected Pack file: ${name}`);
      await route.fulfill({
        status: 200,
        contentType: name.endsWith('.mjs') ? 'text/javascript' : 'application/json',
        body: bytes,
      });
    });
    return {
      createComposition: () => assembleProductPacks(artifacts),
      dispose: () => rm(output, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

async function exportBrowser(page: Page) {
  return page.evaluate(async () => {
    const world = window.__seedlandsHarness!.world;
    await world.clock({ kind: 'pause' });
    const result = await world.checkpoint({ kind: 'export' });
    if (!result.ok || !result.data.snapshot) throw new Error(JSON.stringify(result));
    return result.data.snapshot;
  });
}

test('同一点击转换 ESM 经 Headless→Browser→Headless，实际点击采用选中槽匹配且保留库存与地形', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const pack = await example(page, 'click-conversion');
  const headless = await HeadlessSession.create({
    seedText: 'crosshost-click-conversion',
    platform: testCorePlatform,
    createComposition: pack.createComposition,
  });
  try {
    await headless.world.clock({ kind: 'pause' });
    const server = headless.runtime.server,
      actorId = headless.runtime.playerId;
    const edits = [];
    for (let x = -2; x <= 2; x++)
      for (let z = -2; z <= 3; z++) {
        edits.push({ x, y: 59, z, value: 3 });
        for (let y = 60; y < 64; y++) edits.push({ x, y, z, value: 0 });
      }
    edits.push({ x: 0, y: 60, z: 0, value: 4 });
    server.editBatch({ actorId: 'finite-material-fixture', edits });
    headless.runtime.setPlayerPosition([0.5, 60, -1]);
    expect((await headless.runtime.performAction({ type: 'begin-break', position: [0, 60, 0] })).result).toMatchObject({
      success: true,
    });
    await headless.world.clock({ kind: 'advance', elapsedMs: 300 });
    headless.runtime.setPlayerPosition([0.5, 60, 0.5]);
    await headless.world.clock({ kind: 'advance', elapsedMs: 400 });
    expect(server.getInventory(actorId).slots[0]).toEqual({ itemId: 'sample:wood', count: 1 });
    const exported = await headless.world.checkpoint({ kind: 'export' });
    if (!exported.ok || !exported.data.snapshot) throw new Error(JSON.stringify(exported));
    await startHarnessWorld(page, 'browser-click-conversion');
    const initial = await exportBrowser(page);
    expect(initial.gameplay.composition?.playbookId).toBe('seedlands:click-conversion');
    expect(initial.gameplay.composition?.definitionMap.modules.map((entry) => entry.id)).not.toContain(
      'seedlands:recipe-crafting-module',
    );
    expect(
      await page.evaluate(
        (snapshot) =>
          window.__seedlandsHarness!.world.checkpoint({
            kind: 'restore',
            snapshot: snapshot as FrozenGameSaveSnapshot,
          }),
        exported.data.snapshot as unknown,
      ),
    ).toMatchObject({ ok: true });
    await page.evaluate(() => window.__seedlandsHarness!.world.clock({ kind: 'run' }));
    await lockPointer(page);
    await page.keyboard.press('Digit2');
    await page.keyboard.press('KeyE');
    await expect(page.getByRole('button', { name: '缺少材料 石块', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '关闭背包', exact: true }).click();
    await lockPointer(page);
    await page.keyboard.press('Digit1');
    await page.keyboard.press('KeyE');
    await page.getByRole('button', { name: '合成 石块', exact: true }).click();
    await expect(page.getByRole('grid', { name: '背包槽位' }).locator('[data-item="sample:stone"]')).toContainText('2');
    await page.screenshot({ path: info.outputPath('alternative-click-converted.png') });
    await page.getByRole('button', { name: '关闭背包', exact: true }).click();
    await lockPointer(page);
    await page.mouse.move(0, 0);
    await moveHarnessPlayer(page, 0.5, 61.6, 2.5);
    await setHarnessView(page, 0, -40.36);
    await expect(page.locator('#target-card[data-voxel="3"]')).toBeVisible();
    await page.mouse.click(0, 0, { button: 'right' });
    await expect.poll(() => page.evaluate(() => window.__seedlandsHarness!.getVoxelAt!(0, 60, 0))).toBe(3);
    const checkpoint = await exportBrowser(page);
    expect(await headless.world.checkpoint({ kind: 'restore', snapshot: checkpoint })).toMatchObject({ ok: true });
    expect(headless.runtime.server.getInventory(actorId).slots[0]).toEqual({ itemId: 'sample:stone', count: 1 });
    expect(headless.runtime.server.getVoxel(0, 60, 0)).toBe(3);
    expect(errors).toEqual([]);
  } finally {
    await headless.dispose();
    await pack.dispose();
  }
});

test('独立建造 ESM 在 Browser 无隐式生态/Combat/Needs，通过正常目录启用创造', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const pack = await example(page, 'builder');
  try {
    await startHarnessWorld(page, 'browser-empty-builder');
    const checkpoint = await exportBrowser(page);
    expect(checkpoint.gameplay.composition?.playbookId).toBe('seedlands:builder');
    expect(checkpoint.gameplay.simulation.actors).toHaveLength(0);
    expect(checkpoint.gameplay.composition?.definitionMap.modules.map((entry) => entry.id)).not.toContain(
      'seedlands:needs-module',
    );
    await page.evaluate(() => window.__seedlandsHarness!.world.clock({ kind: 'run' }));
    await page.keyboard.press('KeyE');
    await page.getByRole('button', { name: '切换创造模式', exact: true }).click();
    await expect(page.locator('#actor-mode-status')).toHaveText('创造模式');
    await expect(page.getByRole('button', { name: '将石块放入创造快捷栏 1', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await pack.dispose();
  }
});
