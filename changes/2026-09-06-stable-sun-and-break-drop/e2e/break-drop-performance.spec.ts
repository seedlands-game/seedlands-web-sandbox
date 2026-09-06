import { expect, test, type Page } from '@playwright/test';
import type { HarnessApi } from '../../../src/app/game-harness';
import { PLAYER_FEET_OFFSET } from '../../../src/app/player-view-offsets';
import { lockPointer, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

type DropFrame = Readonly<{ at: number; voxels: readonly number[] }>;
type DropMotionFrame = Readonly<{
  at: number;
  presentedY: number | null;
  authorityY: number | null;
  grounded: boolean | null;
}>;
type DropCaptureWindow = Window & {
  __breakDropCapture?: { running: boolean; frames: DropFrame[] };
  __dropMotionCapture?: { running: boolean; frames: DropMotionFrame[] };
};

const quantile = (values: readonly number[], q: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? 0;
};

const state = (page: Page) => page.evaluate(() => (window.__seedlandsHarness as unknown as HarnessApi).snapshot());

const queryDirtDrops = (page: Page) =>
  page.evaluate(async () => {
    const harness = window.__seedlandsHarness as unknown as HarnessApi;
    const result = await harness.executeGameplayCommand({ type: 'query-nearby', radius: 12 });
    if (!result.success) throw new Error(result.error.message);
    const entities = (result.data as { entities?: Array<Record<string, unknown>> } | undefined)?.entities ?? [];
    return entities
      .filter(
        (entity) =>
          entity.type === 'world-item' &&
          (entity.stack as { itemId?: unknown } | undefined)?.itemId === 'dirt-block' &&
          Array.isArray(entity.position) &&
          Number(entity.position[2]) <= -2,
      )
      .map((entity) => String(entity.id));
  });

const dirtInventoryCount = (page: Page) =>
  page.evaluate(async () => {
    const harness = window.__seedlandsHarness as unknown as HarnessApi;
    const result = await harness.executeGameplayCommand({ type: 'query-inventory' });
    if (!result.success) throw new Error(result.error.message);
    const slots = (result.data as { inventory?: { slots?: Array<{ itemId?: string; count?: number }> } } | undefined)
      ?.inventory?.slots;
    return (slots ?? [])
      .filter(({ itemId }) => itemId === 'dirt-block')
      .reduce((count, stack) => count + (stack.count ?? 0), 0);
  });

test.use({ video: 'on', viewport: { width: 1920, height: 1080 } });

test('真实连续采集生成掉落并落地时不产生事件相关长帧', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await startHarnessWorld(page, 'break-drop-performance');
  await page.evaluate(async () => {
    const harness = window.__seedlandsHarness as unknown as HarnessApi;
    await harness.fillWorld({ from: [-3, 48, -7], to: [3, 48, 2], voxel: 3 });
    await harness.fillWorld({ from: [-3, 49, -7], to: [3, 57, 2], voxel: 0 });
    await harness.setVoxelAt(0, 52, 0, 3);
    await harness.setVoxelAt(0, 53, -3, 2);
    await harness.setVoxelAt(0, 53, -4, 2);
    await harness.movePlayerTo(0.5, 54.6, 0.5);
    harness.setView(0, -20);
  });
  await waitForSnapshot(
    page,
    (snapshot) =>
      snapshot.onGround &&
      snapshot.generationQueue === 0 &&
      snapshot.meshingQueue === 0 &&
      snapshot.performance.uploadQueueDepth === 0,
  );
  await page.bringToFront();
  await lockPointer(page);
  const before = await state(page);
  await page.evaluate(() => {
    const harness = window.__seedlandsHarness as unknown as HarnessApi;
    harness.beginPerformanceScenario('break-drop-performance');
    const target = window as DropCaptureWindow;
    target.__breakDropCapture = { running: true, frames: [] };
    const capture = () => {
      const active = target.__breakDropCapture;
      if (!active?.running) return;
      active.frames.push({
        at: performance.now(),
        voxels: [harness.getVoxelAt?.(0, 53, -3) ?? -1, harness.getVoxelAt?.(0, 53, -4) ?? -1],
      });
      requestAnimationFrame(capture);
    };
    requestAnimationFrame(capture);
  });

  await page.mouse.down({ button: 'left' });
  try {
    await page.waitForFunction(() => {
      const harness = window.__seedlandsHarness as unknown as HarnessApi;
      return harness.getVoxelAt?.(0, 53, -3) === 0 && harness.getVoxelAt?.(0, 53, -4) === 0;
    });
  } finally {
    await page.mouse.up({ button: 'left' });
  }
  const broken = await state(page);
  await page.waitForFunction(
    (targetTick) => (window.__seedlandsHarness as unknown as HarnessApi).snapshot().authority.physicsTick >= targetTick,
    broken.authority.physicsTick + 180,
  );
  const nearby = await queryDirtDrops(page);
  expect(nearby).toHaveLength(2);
  const grounded = await page.evaluate((ids) => {
    const harness = window.__seedlandsHarness as unknown as HarnessApi;
    return ids.map((id) => harness.authorityBody(id));
  }, nearby);
  expect(grounded.every((body) => body?.grounded && Math.abs(body.position[1] - 49) < 0.001)).toBe(true);

  const evidence = await page.evaluate(() => {
    const harness = window.__seedlandsHarness as unknown as HarnessApi;
    const target = window as DropCaptureWindow;
    if (target.__breakDropCapture) target.__breakDropCapture.running = false;
    return {
      frames: target.__breakDropCapture?.frames ?? [],
      performance: harness.snapshot().performance,
      trace: harness.exportPerformanceTrace(),
    };
  });
  const frameDeltas = evidence.frames.slice(1).map((frame, index) => frame.at - evidence.frames[index]!.at);
  const firstBreakIndex = evidence.frames.findIndex((frame) => frame.voxels.some((voxel) => voxel === 0));
  expect(firstBreakIndex).toBeGreaterThan(0);
  const eventFrameDeltas = frameDeltas.slice(Math.max(0, firstBreakIndex - 1));
  const summary = {
    sourceSha: process.env.SEEDLANDS_E2E_SOURCE_SHA ?? 'UNSPECIFIED',
    before,
    broken,
    nearby,
    grounded,
    frame: {
      count: eventFrameDeltas.length,
      p50Ms: quantile(eventFrameDeltas, 0.5),
      p95Ms: quantile(eventFrameDeltas, 0.95),
      maxMs: Math.max(...eventFrameDeltas),
    },
    performance: evidence.performance,
  };
  await testInfo.attach('break-drop-frame-summary', {
    body: JSON.stringify(summary, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('break-drop-frames', {
    body: JSON.stringify(evidence.frames),
    contentType: 'application/json',
  });
  await testInfo.attach('break-drop-trace', {
    body: JSON.stringify(evidence.trace),
    contentType: 'application/json',
  });
  await testInfo.attach('break-drop-landed', { body: await page.screenshot(), contentType: 'image/png' });

  expect(eventFrameDeltas.length).toBeGreaterThan(60);
  expect(summary.frame.p95Ms).toBeLessThanOrEqual(20);
  expect(summary.frame.maxMs).toBeLessThanOrEqual(1000 / 30);
});

test('真实掉落节点按渲染帧连续落地且拾取后不残留', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await startHarnessWorld(page, 'break-drop-motion');
  await page.evaluate(async () => {
    const harness = window.__seedlandsHarness as unknown as HarnessApi;
    await harness.fillWorld({ from: [-3, 53, -7], to: [3, 53, 2], voxel: 3 });
    await harness.fillWorld({ from: [-3, 54, -7], to: [3, 60, 2], voxel: 0 });
    await harness.setVoxelAt(0, 56, 0, 3);
    await harness.setVoxelAt(0, 57, -3, 2);
    await harness.movePlayerTo(0.5, 58.6, 0.5);
    harness.setView(0, -20);
  });
  await waitForSnapshot(
    page,
    (snapshot) =>
      snapshot.onGround &&
      snapshot.generationQueue === 0 &&
      snapshot.meshingQueue === 0 &&
      snapshot.performance.uploadQueueDepth === 0,
  );
  const inventoryBefore = await dirtInventoryCount(page);
  await page.bringToFront();
  await lockPointer(page);
  await page.mouse.down({ button: 'left' });
  try {
    await page.waitForFunction(
      () => (window.__seedlandsHarness as unknown as HarnessApi).getVoxelAt?.(0, 57, -3) === 0,
    );
  } finally {
    await page.mouse.up({ button: 'left' });
  }

  let ids: string[] = [];
  await expect
    .poll(async () => {
      ids = await queryDirtDrops(page);
      return ids.length;
    })
    .toBe(1);
  const dropId = ids[0]!;
  await page.waitForFunction(
    (id) => (window.__seedlandsHarness as unknown as HarnessApi).presentedEntityPosition(id) !== null,
    dropId,
  );
  await page.evaluate((id) => {
    const harness = window.__seedlandsHarness as unknown as HarnessApi;
    const target = window as DropCaptureWindow;
    target.__dropMotionCapture = { running: true, frames: [] };
    const capture = () => {
      const active = target.__dropMotionCapture;
      if (!active?.running) return;
      const authority = harness.authorityBody(id);
      active.frames.push({
        at: performance.now(),
        presentedY: harness.presentedEntityPosition(id)?.[1] ?? null,
        authorityY: authority?.position[1] ?? null,
        grounded: authority?.grounded ?? null,
      });
      requestAnimationFrame(capture);
    };
    requestAnimationFrame(capture);
  }, dropId);

  await page.waitForFunction(
    (id) => (window.__seedlandsHarness as unknown as HarnessApi).authorityBody(id)?.grounded === true,
    dropId,
  );
  await page.waitForFunction(() => {
    const frames = (window as DropCaptureWindow).__dropMotionCapture?.frames ?? [];
    const landed = frames.findIndex(({ grounded }) => grounded === true);
    const latest = frames.at(-1);
    return (
      landed >= 0 &&
      frames.length >= landed + 12 &&
      latest !== undefined &&
      latest.presentedY !== null &&
      latest.authorityY !== null &&
      Math.abs(latest.presentedY - (latest.authorityY + 0.1)) <= 0.001
    );
  });
  const motion = await page.evaluate(() => {
    const target = window as DropCaptureWindow;
    if (target.__dropMotionCapture) target.__dropMotionCapture.running = false;
    return target.__dropMotionCapture?.frames ?? [];
  });
  const falling = motion.filter(
    (frame): frame is DropMotionFrame & { presentedY: number; authorityY: number } =>
      frame.grounded === false && frame.presentedY !== null && frame.authorityY !== null,
  );
  const presentedDeltas = falling.slice(1).map((frame, index) => frame.presentedY - falling[index]!.presentedY);
  const movedFrameRatio =
    presentedDeltas.filter((delta) => Math.abs(delta) > 0.000_01).length / Math.max(1, presentedDeltas.length);
  const groundedFrames = motion.filter(
    (frame): frame is DropMotionFrame & { presentedY: number; authorityY: number } =>
      frame.grounded === true && frame.presentedY !== null && frame.authorityY !== null,
  );
  const landingStart = groundedFrames[0];
  const landingAfterTwelveFrames = groundedFrames[11];
  const landed = groundedFrames.at(-1);
  expect(falling.length).toBeGreaterThan(30);
  expect(movedFrameRatio).toBeGreaterThanOrEqual(0.75);
  expect(Math.max(...presentedDeltas)).toBeLessThanOrEqual(0.000_01);
  expect(groundedFrames.length).toBeGreaterThanOrEqual(12);
  expect(landingStart).toBeDefined();
  expect(landingAfterTwelveFrames).toBeDefined();
  const initialLandingError = Math.abs(landingStart!.presentedY - (landingStart!.authorityY + 0.1));
  const twelveFrameElapsedSeconds = (landingAfterTwelveFrames!.at - landingStart!.at) / 1000;
  const expectedTwelveFrameError = initialLandingError * Math.exp(-twelveFrameElapsedSeconds / 0.055) + 0.002;
  expect(
    Math.abs(landingAfterTwelveFrames!.presentedY - (landingAfterTwelveFrames!.authorityY + 0.1)),
  ).toBeLessThanOrEqual(expectedTwelveFrameError);
  expect(landed).toBeDefined();
  expect(landed!.presentedY).toBeGreaterThanOrEqual(landed!.authorityY + 0.1 - 0.001);
  expect(Math.abs(landed!.presentedY - (landed!.authorityY + 0.1))).toBeLessThanOrEqual(0.001);

  const landedBody = await page.evaluate(
    (id) => (window.__seedlandsHarness as unknown as HarnessApi).authorityBody(id),
    dropId,
  );
  expect(landedBody).not.toBeNull();
  await page.evaluate(
    async ({ position: [x, y, z], feetOffset }) => {
      await (window.__seedlandsHarness as unknown as HarnessApi).movePlayerTo(x, y + feetOffset, z);
    },
    { position: landedBody!.position, feetOffset: PLAYER_FEET_OFFSET },
  );
  await page.waitForFunction(
    (id) => (window.__seedlandsHarness as unknown as HarnessApi).authorityBody(id) === null,
    dropId,
  );
  await page.waitForFunction(
    (id) => (window.__seedlandsHarness as unknown as HarnessApi).presentedEntityPosition(id) === null,
    dropId,
  );
  expect(await dirtInventoryCount(page)).toBe(inventoryBefore + 1);

  await testInfo.attach('break-drop-motion-summary', {
    body: JSON.stringify(
      { dropId, inventoryBefore, movedFrameRatio, frames: motion.length, falling: falling.length },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await testInfo.attach('break-drop-motion-frames', {
    body: JSON.stringify(motion),
    contentType: 'application/json',
  });
  await testInfo.attach('break-drop-picked-up', { body: await page.screenshot(), contentType: 'image/png' });
});
