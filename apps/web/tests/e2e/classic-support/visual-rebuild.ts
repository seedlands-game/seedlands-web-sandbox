import { aimAtVoxelWithRealMouse } from './aim';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { classicCreatureKinds } from '../../../src/client/presentation/classic-creature-definitions';
import { browserArtifact } from './identity';
import { observeBrowserRuntime } from './evidence';
import { startClassicWorld } from './start';
import { classicScenario } from './scenario';
import { classicBenchmark } from './settings';
import { lockPointer, snapshot, voxelAt, waitForSnapshot, walkTo, type ClassicWindow } from './harness';

/** Fixed gallery for real production rendering; setup commands are not input acceptance. */
export async function verifyVisualRebuild({ page }: { page: Page }, testInfo: TestInfo) {
  test.skip(classicBenchmark.enabled, 'Visual captures are correctness diagnostics, not benchmark samples.');
  test.setTimeout(240_000);
  const observed = observeBrowserRuntime(page);
  const glbs = new Set<string>();
  const renderErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') renderErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.ok() && response.url().includes('/models/classic/')) glbs.add(new URL(response.url()).pathname);
  });
  await startClassicWorld(page, { ...classicScenario, seed: 'classic-visual-v3', quality: 'low' });
  if (await page.locator('#debug').isVisible()) await page.keyboard.press('F3');
  await expect(page.locator('#companion')).toHaveCount(0);
  const artifact = await browserArtifact(page);
  expect(artifact.ok).toBe(true);
  const runId = process.env.SEEDLANDS_HARNESS_RUN_ID ?? randomUUID();
  await page.evaluate(
    async (kinds) => {
      const harness = (window as unknown as ClassicWindow).__seedlandsHarness!;
      const command = async (input: Record<string, unknown>) => {
        const result = await harness.world.command(input);
        if (!result.ok) throw new Error(result.error.message);
        return result.data;
      };
      const pause = await harness.world.clock({ kind: 'pause' });
      if (!pause.ok) throw new Error(pause.error.message);
      await command({ type: 'set-mode', mode: 'creative' });
      await harness.fillWorld({ from: [-12, 59, -12], to: [12, 59, 24], voxel: 3 });
      await harness.fillWorld({ from: [-12, 60, -12], to: [12, 66, 24], voxel: 0 });
      for (let i = 0; i < kinds.length; i++)
        await command({
          type: 'spawn-actor',
          id: `visual-${kinds[i]}`,
          archetype: kinds[i],
          position: [-6 + (i % 4) * 4, 60, -6 + Math.floor(i / 4) * 4],
        });
      for (const [i, voxel] of [31, 32, 33, 34, 35, 59, 61, 62].entries())
        await harness.setVoxelAt(-7 + i * 2, 60, 9, voxel);
      await command({ type: 'teleport', position: [0.5, 61.6, 19.5] });
      harness.setView(0, -8);
      harness.setTimePaused(true);
      await harness.setWorldTime(12);
    },
    [...classicCreatureKinds],
  );
  await expect.poll(() => glbs.size, { timeout: 30_000 }).toBe(12);
  await waitForSnapshot(page, (s) => s.gameplay.presentedEntityCount >= 12 && s.renderedChunks > 0);
  const capture = async (name: string) => {
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const h = (window as unknown as ClassicWindow).__seedlandsHarness!;
            return [-1, 0].every((x) =>
              [-1, 0].every((z) => {
                const revision = h.getChunkRevision?.(x, 1, z);
                return (
                  revision !== null && revision !== undefined && h.getRenderedChunkRevision?.(x, 1, z) === revision
                );
              }),
            );
          }),
        { timeout: 30_000 },
      )
      .toBe(true);
    await waitForSnapshot(
      page,
      (s) => s.visualEffects.blockLightReady && s.visualEffects.blockLightSourceRevision === s.worldRevision,
    );
    await page.evaluate(async () => {
      for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    const hiddenUi = name.endsWith('-closeup')
      ? await page.addStyleTag({ content: '#ui { visibility: hidden !important; }' })
      : null;
    await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
    await hiddenUi?.evaluate((element) => {
      element.parentNode?.removeChild(element);
    });
    await testInfo.attach(`${name}-camera`, {
      body: JSON.stringify((await snapshot(page))?.player),
      contentType: 'application/json',
    });
  };
  await capture('day-gallery');
  for (const view of [
    { name: 'pig-front-closeup', position: [-6, 61.1, -9.2], target: [-6, 60.45, -6] },
    { name: 'skeleton-bow-front-closeup', position: [6, 61.2, -5.2], target: [6, 60.9, -2] },
    { name: 'skeleton-bow-side-closeup', position: [8.5, 61.2, -3.5], target: [6, 60.9, -2] },
    { name: 'plants-closeup', position: [0, 61.4, 12.5], target: [0, 60.5, 9.5] },
  ]) {
    await page.evaluate(async ({ position, target }) => {
      const h = (window as unknown as ClassicWindow).__seedlandsHarness!;
      const result = await h.world.command({ type: 'teleport', position });
      if (!result.ok) throw new Error(result.error.message);
      for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const camera = h.snapshot().player;
      const dx = target[0]! - camera[0],
        dy = target[1]! - camera[1],
        dz = target[2]! - camera[2];
      h.setView((Math.atan2(-dx, -dz) * 180) / Math.PI, (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI);
    }, view);
    await capture(view.name);
  }
  await page.evaluate(async () => {
    const h = (window as unknown as ClassicWindow).__seedlandsHarness!;
    const result = await h.world.command({ type: 'teleport', position: [0.5, 61.6, 19.5] });
    if (!result.ok) throw new Error(result.error.message);
    h.setView(0, -8);
  });
  await page.evaluate(async () => {
    const h = (window as unknown as ClassicWindow).__seedlandsHarness!;
    const result = await h.world.clock({ kind: 'run' });
    if (!result.ok) throw new Error(result.error.message);
  });
  await capture('animated-gallery-early');
  const animationTick = (await snapshot(page))!.authority.physicsTick;
  await waitForSnapshot(page, (s) => s.authority.physicsTick >= animationTick + 10);
  await capture('animated-gallery-later');
  await page.evaluate(async () => {
    const h = (window as unknown as ClassicWindow).__seedlandsHarness!;
    await h.world.clock({ kind: 'pause' });
    await h.setWorldTime(0);
    for (const [i, voxel] of [54, 9, 27, 29, 69, 71, 73, 10].entries()) await h.setVoxelAt(-7 + i * 2, 60, 13, voxel);
  });
  await capture('night-eight-light-types');
  await page.evaluate(async () => {
    const h = (window as unknown as ClassicWindow).__seedlandsHarness!;
    for (let i = 0; i < 8; i++) await h.setVoxelAt(-7 + i * 2, 60, 13, 0);
  });
  await capture('night-sources-removed');
  for (const [name, voxel] of [
    ['torch', 54],
    ['glowstone', 9],
    ['lava', 27],
    ['fire', 29],
    ['jack-o-lantern', 69],
    ['lit-furnace', 71],
    ['lit-redstone-ore', 73],
    ['lantern', 10],
  ] as const) {
    await page.evaluate(async (id) => {
      await (window as unknown as ClassicWindow).__seedlandsHarness!.setVoxelAt(0, 60, 16, id);
    }, voxel);
    await capture(`night-isolated-${name}`);
  }
  await page.evaluate(async () => {
    await (window as unknown as ClassicWindow).__seedlandsHarness!.setVoxelAt(0, 60, 16, 0);
  });
  // Lock against an empty direction first: the focus click is not the break under test.
  await page.evaluate(() => (window as unknown as ClassicWindow).__seedlandsHarness!.setView(180, 0));
  await lockPointer(page);
  await page.evaluate(async () => {
    const h = (window as unknown as ClassicWindow).__seedlandsHarness!;
    for (const command of [
      { type: 'set-flight', enabled: false },
      { type: 'teleport', position: [-6.5, 61.6, 11.5] },
    ]) {
      const result = await h.world.command(command);
      if (!result.ok) throw new Error(result.error.message);
    }
    await h.setWorldTime(12);
    h.setView(0, -18);
    await h.world.clock({ kind: 'run' });
  });
  await waitForSnapshot(page, (s) => s.onGround);
  await aimAtVoxelWithRealMouse(page, [-7, 60, 9]);
  await walkTo(page, [-6.5, 7.5], { timeout: 10_000, tolerance: 0.45 });
  expect(await voxelAt(page, [-7, 60, 9])).toBe(31);
  await capture('plant-real-input-selection-and-walk-through');
  await page.evaluate(async () => {
    const h = (window as unknown as ClassicWindow).__seedlandsHarness!;
    for (const command of [
      { type: 'set-flight', enabled: true },
      { type: 'teleport', position: [0.5, 61.6, 19.5] },
    ]) {
      const result = await h.world.command(command);
      if (!result.ok) throw new Error(result.error.message);
    }
  });
  await page.evaluate(async () => {
    const h = (window as unknown as ClassicWindow).__seedlandsHarness!;
    await h.setWorldTime(12);
    await h.setVoxelAt(0, 61, 17, 3);
    await h.setVoxelAt(0, 61, 16, 3);
    h.setView(0, 0);
    const result = await h.world.clock({ kind: 'run' });
    if (!result.ok) throw new Error(result.error.message);
  });
  await expect.poll(() => voxelAt(page, [0, 61, 17])).toBe(3);
  await aimAtVoxelWithRealMouse(page, [0, 61, 17]);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => voxelAt(page, [0, 61, 17])).toBe(0);
  const breakTick = (await snapshot(page))!.authority.physicsTick;
  await waitForSnapshot(page, (s) => s.authority.physicsTick >= breakTick + 20);
  expect(await voxelAt(page, [0, 61, 16])).toBe(3);
  await capture('creative-one-click-one-block');
  await page.keyboard.press('KeyE');
  await expect(page.locator('#creative-catalog')).toBeVisible();
  await testInfo.attach('creative-catalog-icons', { body: await page.screenshot(), contentType: 'image/png' });
  await page.locator('#creative-item-filter').fill('楼梯');
  await testInfo.attach('creative-stair-icons', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await expect(page.locator('#creative-catalog')).not.toBeVisible();
  await page.evaluate(async () => {
    const h = (window as unknown as ClassicWindow).__seedlandsHarness!;
    await h.world.clock({ kind: 'pause' });
    await h.setWorldTime(0);
    await h.fillWorld({ from: [-3, 60, 14], to: [3, 63, 23], voxel: 3 });
    await h.fillWorld({ from: [-2, 60, 15], to: [2, 62, 22], voxel: 0 });
    const result = await h.world.command({ type: 'teleport', position: [0.5, 60, 21.5] });
    if (!result.ok) throw new Error(result.error.message);
    h.setView(0, -8);
  });
  await capture('sealed-room-unlit');
  await page.evaluate(async () => {
    await (window as unknown as ClassicWindow).__seedlandsHarness!.setVoxelAt(0, 60, 16, 9);
  });
  await capture('sealed-room-glowstone');
  await page.evaluate(async () => {
    await (window as unknown as ClassicWindow).__seedlandsHarness!.fillWorld({
      from: [-2, 60, 18],
      to: [2, 63, 18],
      voxel: 3,
    });
  });
  await capture('sealed-room-occluding-wall');
  expect(observed.pageErrors).toEqual([]);
  expect(observed.failedResponses).toEqual([]);
  expect(renderErrors).toEqual([]);
  await testInfo.attach('visual-identity-and-observations', {
    body: JSON.stringify(
      {
        runId,
        artifact,
        glbs: [...glbs],
        snapshot: await snapshot(page),
        ...observed,
        renderErrors,
        visualReview: 'Screenshots require human/model inspection; frame capture alone does not assert art quality.',
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
}
