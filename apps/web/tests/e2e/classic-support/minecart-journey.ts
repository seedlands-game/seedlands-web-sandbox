import { expect, type Page, type TestInfo } from '@playwright/test';
import { browserArtifact, browserPackLock, compositionIdentity } from './identity';
import { startClassicWorld } from './start';
import { classicScenario } from './scenario';
import { aimAtVoxelWithRealMouse } from './aim';
import { clickCanvasCenter, closeInventory, moveMouseBy, snapshot, type ClassicWindow } from './harness';
import { observeBrowserRuntime, collectClassicFailureDiagnostics } from './evidence';
import { mouseCorrectionToPoint } from './target-aim';
import { modularPackSmokeEnabled } from './modular-pack-smoke';

export function registerClassicMinecartJourney(test: typeof import('@playwright/test').test) {
  test('Classic 普通矿车以原生右键上车、键盘移动、Shift右键下车并恢复同一存档', async ({ page }, testInfo) => {
    test.skip(modularPackSmokeEnabled, 'Ordinary minecart belongs to the Classic production Pack.');
    test.setTimeout(120_000);
    try {
      await verifyClassicMinecartJourney(page, testInfo);
    } catch (error) {
      await testInfo.attach('classic-minecart-native-failure.json', {
        contentType: 'application/json',
        body: JSON.stringify({
          ...(await collectClassicFailureDiagnostics(page)),
          minecart: await readMinecartInputDiagnostics(page),
        }),
      });
      throw error;
    }
  });
}

async function readMinecartInputDiagnostics(page: Page) {
  return page.evaluate(() => {
    const h = (window as unknown as ClassicWindow).__seedlandsHarness;
    if (!h) return { available: false, hud: document.body.innerText.slice(0, 2000) };
    const s = h.snapshot();
    return {
      aimed: h.aimedVoxelTarget(),
      rail: h.getVoxelAt?.(2, 31, 0),
      fluid: h.getFluidCell?.(2, 31, 0),
      player: s.player,
      viewAngles: s.viewAngles,
      interactionAttempts: s.interactionAttempts,
      hotbar: document.querySelector('#hotbar button[aria-pressed="true"]')?.getAttribute('data-item'),
      hud: document.body.innerText.slice(0, 2000),
    };
  });
}

const transportSnapshot = (page: Page) =>
  page.evaluate(() => (window as unknown as ClassicWindow).__seedlandsHarness!.transportSnapshot());

async function aimAtCart(page: Page, position: readonly [number, number, number]) {
  for (let attempt = 0; attempt < 18; attempt++) {
    const state = await snapshot(page);
    if (!state) throw new Error('Minecart aim has no accepted player snapshot.');
    const correction = mouseCorrectionToPoint(state.player, state.viewAngles, [
      position[0],
      position[1] + 0.35,
      position[2],
    ]);
    if (Math.abs(correction.dx) * 0.13 < 0.5 && Math.abs(correction.dy) * 0.13 < 0.5) return;
    await moveMouseBy(page, correction.dx, correction.dy);
  }
  throw new Error('Native minecart aim did not converge.');
}

/** Fixtures prepare terrain; all deployment, mount, movement and dismount use native input. */
export async function verifyClassicMinecartJourney(page: Page, testInfo: TestInfo) {
  const runtime = observeBrowserRuntime(page);
  const scenario = { ...classicScenario, seed: 'classic-ordinary-minecart-75' };
  await startClassicWorld(page, scenario);
  const artifact = await browserArtifact(page),
    packLock = await browserPackLock(page),
    composition = await compositionIdentity(page);
  expect(artifact.ok).toBe(true);
  expect(packLock.ok).toBe(true);
  expect(composition?.playbookId).toBe('seedlands:overworld');
  await page.evaluate(async () => {
    const harness = (window as unknown as ClassicWindow).__seedlandsHarness!;
    const pause = await harness.world.clock({ kind: 'pause' });
    if (!pause.ok) throw new Error('Fixture pause failed.');
    for (const command of [
      { from: [0, 30, -2], to: [12, 30, 4], voxel: 3 },
      { from: [0, 31, -2], to: [12, 34, 4], voxel: 0 },
      { from: [1, 31, 0], to: [9, 31, 0], voxel: 39 },
    ] as const) {
      const result = await harness.fillWorld(command);
      if (!result || result.reason) throw new Error(`Minecart fixture rejected: ${result?.reason}`);
    }
    const teleport = await harness.world.command({ type: 'teleport', position: [2.5, 32.6, 2.5] });
    if (!teleport.ok) throw new Error('Fixture teleport failed.');
    const run = await harness.world.clock({ kind: 'run' });
    if (!run.ok) throw new Error('Fixture clock resume failed.');
  });
  await page.keyboard.press('KeyE');
  const inventory = page.getByRole('dialog', { name: '背包与合成' });
  await expect(inventory).toBeVisible();
  await inventory.getByRole('button', { name: '切换创造模式', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: '创造内容目录' });
  await expect(catalog).toBeVisible();
  await catalog.locator('#creative-item-filter').fill('矿车');
  await catalog.getByRole('button', { name: /^将矿车放入创造快捷栏 / }).click();
  await closeInventory(page);
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game');
  await expect(page.locator('#hotbar button[aria-pressed="true"]')).toHaveAttribute('data-item', 'minecart');
  await aimAtVoxelWithRealMouse(page, [2, 31, 0], [2, 32, 0]);
  await testInfo.attach('classic-minecart-before-deploy.json', {
    contentType: 'application/json',
    body: JSON.stringify(await readMinecartInputDiagnostics(page)),
  });
  await clickCanvasCenter(page, 'right');
  await testInfo.attach('classic-minecart-after-deploy.json', {
    contentType: 'application/json',
    body: JSON.stringify(await readMinecartInputDiagnostics(page)),
  });
  await expect.poll(async () => (await transportSnapshot(page))?.transports.length).toBe(1);
  const deployed = (await transportSnapshot(page))!.transports[0]!;
  expect(deployed.definitionId).toBe('seedlands:minecart');
  expect(deployed.rider).toBeNull();
  await expect
    .poll(() =>
      page.evaluate(
        (id) => (window as unknown as ClassicWindow).__seedlandsHarness!.presentedEntityModelReady(id),
        deployed.reference.entityId,
      ),
    )
    .toBe(true);
  await aimAtCart(page, deployed.pose.position);
  await testInfo.attach('classic-minecart-deployed.png', { contentType: 'image/png', body: await page.screenshot() });
  await clickCanvasCenter(page, 'right');
  await expect.poll(async () => (await transportSnapshot(page))?.transports[0]?.rider?.entityId).toBeDefined();
  const mounted = (await transportSnapshot(page))!.transports[0]!;
  expect(mounted.reference).toEqual(deployed.reference);
  const before = await snapshot(page);
  if (!before) throw new Error('Minecart movement baseline unavailable.');
  // Turn with real mouse toward +X, then keep the key held until an accepted movement is observed.
  const turn = mouseCorrectionToPoint(
    before.player,
    before.viewAngles,
    [before.player[0] + 3, before.player[1], before.player[2]],
    { wholeTurn: true },
  );
  await moveMouseBy(page, turn.dx, turn.dy);
  await page.keyboard.down('KeyW');
  try {
    await expect
      .poll(async () => (await transportSnapshot(page))!.transports[0]!.pose.position[0], { timeout: 10_000 })
      .toBeGreaterThan(mounted.pose.position[0] + 0.1);
    // Reach the fixture's known rail end so collision, rather than asymptotic drag, stops the cart.
    await expect
      .poll(async () => (await transportSnapshot(page))!.transports[0]!.pose.position[0], { timeout: 10_000 })
      .toBeGreaterThan(8.5);
  } finally {
    await page.keyboard.up('KeyW');
  }
  const moved = (await transportSnapshot(page))!.transports[0]!;
  await expect
    .poll(async () => Math.hypot(...(await transportSnapshot(page))!.transports[0]!.velocity), { timeout: 10_000 })
    .toBeLessThan(1e-8);
  await page.keyboard.down('ShiftLeft');
  try {
    await clickCanvasCenter(page, 'right');
  } finally {
    await page.keyboard.up('ShiftLeft');
  }
  await expect.poll(async () => (await transportSnapshot(page))?.transports[0]?.rider).toBeNull();
  const dismountedSnapshot = (await transportSnapshot(page))!;
  const dismounted = dismountedSnapshot.transports[0]!;
  await page.evaluate(() => (window as unknown as ClassicWindow).__seedlandsHarness!.flushSave());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#seed').fill(scenario.seed);
  await page.getByRole('button', { name: '进入世界', exact: true }).click();
  await page.locator('#start-card').waitFor({ state: 'hidden' });
  await expect
    .poll(async () => (await transportSnapshot(page))?.transports[0]?.reference)
    .toEqual({ ...dismounted.reference, epoch: dismounted.reference.epoch + 1 });
  const restoredSnapshot = (await transportSnapshot(page))!;
  const restored = restoredSnapshot.transports[0]!;
  expect(restoredSnapshot.runtimeEpoch).not.toBe(dismountedSnapshot.runtimeEpoch);
  const [staleReferenceInspection, currentReferenceInspection] = await page.evaluate(
    async ({ stale, current }) => {
      const world = (window as unknown as ClassicWindow).__seedlandsHarness!.world;
      return Promise.all([
        world.inspect({ kind: 'entity-reference', reference: stale }),
        world.inspect({ kind: 'entity-reference', reference: current }),
      ]);
    },
    { stale: dismounted.reference, current: restored.reference },
  );
  expect(staleReferenceInspection).toMatchObject({
    ok: true,
    data: { kind: 'entity-reference', reference: dismounted.reference, status: 'stale' },
  });
  expect(currentReferenceInspection).toMatchObject({
    ok: true,
    data: { kind: 'entity-reference', reference: restored.reference, status: 'current' },
  });
  expect(restored.pose.position).toEqual(dismounted.pose.position);
  expect(restored.rider).toBeNull();
  expect(runtime.pageErrors).toEqual([]);
  expect(runtime.failedResponses).toEqual([]);
  await testInfo.attach('classic-minecart-native-input.json', {
    contentType: 'application/json',
    body: JSON.stringify({
      artifact,
      packLock,
      composition,
      deployed,
      mounted,
      moved,
      dismounted,
      restored,
      staleReferenceInspection,
      currentReferenceInspection,
    }),
  });
  await testInfo.attach('classic-minecart-restored.png', { contentType: 'image/png', body: await page.screenshot() });
}
