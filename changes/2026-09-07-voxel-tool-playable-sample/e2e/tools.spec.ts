import { expect, test, type Page } from '@playwright/test';
import { lockPointer, snapshot, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

const probePath = '/changes/2026-09-07-voxel-tool-playable-sample/e2e/tool-probe.ts';
const probe = (page: Page, itemId: string) =>
  page.evaluate(
    async ({ path, id }) => {
      const module = (await import(path)) as typeof import('./tool-probe');
      return module.presentedTool(id);
    },
    { path: probePath, id: itemId },
  );

test('制作、手持采集、共享掉落模型、存退和资源释放', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const capture = async (name: string) => {
    const path = testInfo.outputPath(`${name}.jpg`);
    await page.screenshot({ path, type: 'jpeg', quality: 85 });
    await testInfo.attach(name, { path, contentType: 'image/jpeg' });
  };
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startHarnessWorld(page, 'mosslight-68');
  await waitForSnapshot(page, (s) => s.onGround && !s.colliding);
  await waitForSnapshot(
    page,
    (s) => s.generationQueue === 0 && s.meshingQueue === 0 && s.performance.uploadQueueDepth === 0,
  );
  await page.keyboard.press('F3');
  await page.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    await h.executeGameplayCommand({ type: 'give-item', itemId: 'wood-block', count: 2 });
    await h.executeGameplayCommand({ type: 'give-item', itemId: 'stone-block', count: 6 });
    await h.setWorldTime(10);
    h.setTimePaused(true);
  });
  await page.keyboard.press('KeyE');
  const panel = page.getByRole('dialog', { name: '背包与合成', exact: true });
  await expect(panel).toBeVisible();
  for (const name of ['木板', '木板', '木斧', '石镐']) {
    const button = panel.getByRole('button', { name: `合成 ${name}`, exact: true });
    await expect(button).toBeEnabled();
    await button.click();
  }
  await expect(panel.getByRole('gridcell', { name: '木斧 1', exact: true })).toBeVisible();
  await expect(panel.getByRole('gridcell', { name: '石镐 1', exact: true })).toBeVisible();
  const axeSlot = Number(await panel.getByRole('gridcell', { name: '木斧 1', exact: true }).getAttribute('data-slot'));
  const pickSlot = Number(await panel.getByRole('gridcell', { name: '石镐 1', exact: true }).getAttribute('data-slot'));
  await capture('crafted-inventory');
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  for (const [slot, id] of [
    [axeSlot, 'wood-axe'],
    [pickSlot, 'stone-pickaxe'],
  ] as const) {
    await page.keyboard.press(`Digit${slot + 1}`);
    await expect.poll(() => probe(page, id)).toMatchObject({ name: `pixel-tool:${id}`, meshes: 1, hand: true });
    expect((await probe(page, id)).vertices).toBeGreaterThan(100);
    await capture(`held-${id}`);
  }
  const start = (await snapshot(page))!;
  const block: [number, number, number] = [
    Math.floor(start.player[0]),
    Math.floor(start.player[1]),
    Math.floor(start.player[2]) - 2,
  ];
  await page.evaluate(async (position) => {
    const h = window.__seedlandsHarness!;
    await h.setVoxelAt(...position, 3);
    const p = h.snapshot()!.player;
    const dx = position[0] + 0.5 - p[0],
      dy = position[1] + 0.5 - p[1],
      dz = position[2] + 0.5 - p[2];
    h.setView((Math.atan2(-dx, -dz) * 180) / Math.PI, (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI);
  }, block);
  await lockPointer(page);
  const revision = (await snapshot(page))!.worldRevision;
  await page.mouse.down();
  await expect(page.locator('#player-action')).toHaveAttribute('data-action', 'mining');
  for (const label of ['early', 'middle', 'late']) {
    await page.waitForTimeout(80);
    await capture(`mining-${label}`);
  }
  await expect.poll(async () => (await snapshot(page))!.worldRevision, { timeout: 8000 }).toBeGreaterThan(revision);
  await page.mouse.up();
  await expect
    .poll(async () => (await probe(page, 'stone-pickaxe')).rotation.every((v) => Math.abs(v) < 0.01))
    .toBe(true);
  await capture('mining-rest');
  await page.keyboard.press('KeyE');
  await expect(panel).toBeVisible();
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  const resources = await page.evaluate(
    async (path) => ((await import(path)) as typeof import('./tool-probe')).resourceLifecycle(),
    probePath,
  );
  expect(resources).toEqual({ same: true, sameAfterEmpty: true, afterNodes: 0, afterFirstLease: 0, destroyed: 1 });
  await testInfo.attach('gpu-lifecycle', { body: JSON.stringify(resources), contentType: 'application/json' });
  for (const width of [700, 1920]) {
    await page.setViewportSize({ width, height: 720 });
    await expect.poll(() => probe(page, 'stone-pickaxe')).toMatchObject({ meshes: 1, hand: true });
    await capture(`viewport-${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  await page.getByRole('button', { name: '保存并返回主菜单', exact: true }).click();
  expect(await probe(page, 'stone-pickaxe')).toMatchObject({ name: null, meshes: 0, hand: false });
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('#settings-quality').selectOption('low');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '继续世界', exact: true }).click();
  await waitForSnapshot(page, (s) => s.onGround && !s.colliding);
  await waitForSnapshot(
    page,
    (s) => s.generationQueue === 0 && s.meshingQueue === 0 && s.performance.uploadQueueDepth === 0,
  );
  await page.keyboard.press('F3');
  await expect.poll(() => probe(page, 'stone-pickaxe')).toMatchObject({ name: 'pixel-tool:stone-pickaxe', meshes: 1 });
  expect((await snapshot(page))!.quality).toBe('low');
  await capture('low-quality-reloaded');
  await page.keyboard.press('KeyE');
  await expect(panel.getByRole('gridcell', { name: '木斧 1', exact: true })).toBeVisible();
  await expect(panel.getByRole('gridcell', { name: '石镐 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  // Existing UI exposes drop as a debug command; do not claim a normal drop hotkey exists.
  await page.keyboard.press('F4');
  await page.getByRole('textbox', { name: '命令', exact: true }).fill(`/drop ${axeSlot} 1`);
  await page.getByRole('textbox', { name: '命令', exact: true }).press('Enter');
  await expect(page.locator('#debug-command-status')).toHaveAttribute('data-state', 'success');
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyE');
  // Dropping at the current position is automatically picked up by the existing authority loop.
  await expect(panel.getByRole('gridcell', { name: '木斧 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  // Stage a separate distant world item via the production store for a readable dropped-model view.
  const worldItem = await page.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    const p = h.snapshot()!.player;
    const position: [number, number, number] = [p[0], p[1] - 0.5, p[2] - 4];
    await h.fillWorld({
      from: [Math.floor(p[0]) - 1, Math.floor(p[1]) - 1, Math.floor(p[2]) - 5],
      to: [Math.floor(p[0]) + 1, Math.floor(p[1]) + 3, Math.floor(p[2]) + 1],
      voxel: 0,
    });
    await h.fillWorld({
      from: [Math.floor(p[0]) - 1, Math.floor(p[1]) - 2, Math.floor(p[2]) - 5],
      to: [Math.floor(p[0]) + 1, Math.floor(p[1]) - 2, Math.floor(p[2]) + 1],
      voxel: 3,
    });
    h.setView(0, -8);
    return h.executeGameplayCommand({ type: 'spawn-world-item', itemId: 'stone-pickaxe', count: 1, position });
  });
  expect(worldItem.success).toBe(true);
  const sharedInWorld = () =>
    page.evaluate(
      async (path) => ((await import(path)) as typeof import('./tool-probe')).worldMatchesHeld('stone-pickaxe'),
      probePath,
    );
  await expect.poll(sharedInWorld).toEqual({ count: 2, same: true });
  await page.waitForTimeout(300);
  await capture('world-tool-and-held');
  await lockPointer(page);
  await page.keyboard.down('KeyW');
  try {
    await expect.poll(async () => (await sharedInWorld()).count, { timeout: 8000 }).toBe(1);
  } finally {
    await page.keyboard.up('KeyW');
  }
  await page.keyboard.press('KeyE');
  await expect(panel.getByRole('gridcell', { name: '石镐 1', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  const target = await page.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    const p = h.snapshot()!.player;
    // Use a staged non-roaming target and clear its sightline via the production edit path.
    await h.fillWorld({
      from: [Math.floor(p[0]) - 1, Math.floor(p[1]) - 1, Math.floor(p[2]) - 3],
      to: [Math.floor(p[0]) + 1, Math.floor(p[1]) + 2, Math.floor(p[2]) - 1],
      voxel: 0,
    });
    await h.fillWorld({
      from: [Math.floor(p[0]) - 1, Math.floor(p[1]) - 2, Math.floor(p[2]) - 3],
      to: [Math.floor(p[0]) + 1, Math.floor(p[1]) - 2, Math.floor(p[2]) - 1],
      voxel: 3,
    });
    h.setView(0, -3);
    return h.executeGameplayCommand({ type: 'spawn-creature', position: [p[0], p[1] - 1, p[2] - 2] });
  });
  expect(target.success).toBe(true);
  await lockPointer(page);
  await page.mouse.click(640, 360);
  await expect(page.locator('#player-action')).toHaveAttribute('data-action', 'attack');
  for (const label of ['early', 'middle']) {
    await page.waitForTimeout(60);
    await capture(`attack-${label}`);
  }
  await expect
    .poll(async () => (await probe(page, 'stone-pickaxe')).rotation.every((v) => Math.abs(v) < 0.01))
    .toBe(true);
  await capture('attack-rest');
  expect(errors).toEqual([]);
});
