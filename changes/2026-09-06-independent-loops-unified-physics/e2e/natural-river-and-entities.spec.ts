import { expect, test, type Page } from '@playwright/test';
import type { HarnessApi } from '../../../src/app/game-harness';
import { lockPointer, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

type AudioSnapshot = {
  unlocked: boolean;
  underwaterFilterHz: number;
  recentSounds: { key: string; sequence: number }[];
};
type NaturalEvidenceWindow = Window & {
  __seedlandsAudio: {
    snapshot(): AudioSnapshot;
    capture(seconds: number): Promise<number[]>;
  };
  __naturalAudioCapture?: Promise<number[]>;
  __naturalRouteFrames?: Array<{
    at: number;
    physicsTick: number;
    position: readonly number[];
    velocity: readonly number[];
    onGround: boolean;
    bodyFraction: number;
    cameraSubmerged: boolean;
  }>;
  __naturalRouteSampling?: boolean;
  __naturalFallFrames?: Array<{
    at: number;
    actor: ReturnType<HarnessApi['authorityBody']>;
    item: ReturnType<HarnessApi['authorityBody']>;
  }>;
  __naturalFallSampling?: boolean;
};

const state = (page: Page) => page.evaluate(() => (window.__seedlandsHarness as unknown as HarnessApi).snapshot());
const audio = (page: Page) =>
  page.evaluate(() => (window as unknown as NaturalEvidenceWindow).__seedlandsAudio.snapshot());

test.use({ video: 'on', viewport: { width: 1920, height: 1080 } });

test('mosslight-68自然河岸需Space上岸，角色与掉落物失去支撑后走权威物理', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await startHarnessWorld(page, 'mosslight-68');
  await page.evaluate(async () => {
    const harness = window.__seedlandsHarness as unknown as HarnessApi;
    await harness.movePlayerTo(30.5, 13.6, -30.5);
    harness.setView(0, 0);
  });
  await waitForSnapshot(
    page,
    (value) =>
      value.generationQueue === 0 &&
      value.meshingQueue === 0 &&
      value.deferredRemeshes === 0 &&
      value.performance.uploadQueueDepth === 0,
  );
  const crossSection = await page.evaluate(() => {
    const harness = window.__seedlandsHarness as unknown as HarnessApi;
    return {
      bank: harness.getVoxelAt?.(30, 11, -31),
      waterTopCell: harness.getVoxelAt?.(31, 11, -32),
      bed: harness.getVoxelAt?.(31, 9, -32),
      version: harness.snapshot().generatorVersion,
    };
  });
  expect(crossSection).toEqual({ bank: 1, waterTopCell: 8, bed: 1, version: 3 });
  await page.bringToFront();
  await lockPointer(page);
  expect((await audio(page)).unlocked).toBe(true);
  await testInfo.attach('natural-river-01-bank', { body: await page.screenshot(), contentType: 'image/png' });
  await page.evaluate(() => {
    const target = window as unknown as NaturalEvidenceWindow;
    target.__naturalAudioCapture = target.__seedlandsAudio.capture(8);
    target.__naturalRouteFrames = [];
    target.__naturalRouteSampling = true;
    const capture = () => {
      if (!target.__naturalRouteSampling) return;
      const value = (window.__seedlandsHarness as unknown as HarnessApi).snapshot();
      target.__naturalRouteFrames!.push({
        at: performance.now(),
        physicsTick: value.authority.physicsTick,
        position: [...value.serverPlayerPosition],
        velocity: [...value.serverPlayerVelocity],
        onGround: value.onGround,
        bodyFraction: value.water.bodyFraction,
        cameraSubmerged: value.water.cameraSubmerged,
      });
      requestAnimationFrame(capture);
    };
    requestAnimationFrame(capture);
  });

  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  try {
    const entered = await waitForSnapshot(page, (value) => value.water.wading && value.water.bodyFraction > 0.2);
    expect(entered.colliding).toBe(false);
    await expect.poll(async () => (await audio(page)).recentSounds.some(({ key }) => key === 'water-enter')).toBe(true);
    await testInfo.attach('natural-river-02-wading', { body: await page.screenshot(), contentType: 'image/png' });

    await page.keyboard.down('ShiftLeft');
    try {
      const submerged = await waitForSnapshot(
        page,
        (value) => value.water.swimming && value.water.cameraSubmerged && value.water.underwaterBlend > 0.75,
      );
      expect(submerged.water.bodyFraction).toBeGreaterThan(0.75);
      await expect.poll(async () => (await audio(page)).underwaterFilterHz).toBeLessThan(8_000);
    } finally {
      await page.keyboard.up('ShiftLeft');
    }
    await testInfo.attach('natural-river-03-submerged', { body: await page.screenshot(), contentType: 'image/png' });

    const reachedOppositeBank = await waitForSnapshot(
      page,
      (value) =>
        value.serverPlayerPosition[0] > 37.5 &&
        value.serverPlayerPosition[0] < 38 &&
        Math.abs(value.serverPlayerVelocity[0]) < 0.01 &&
        (value.water.wading || value.water.swimming),
    );
    const noJumpStart = reachedOppositeBank;
    await expect
      .poll(async () => (await state(page)).authority.physicsTick)
      .toBeGreaterThan(noJumpStart.authority.physicsTick + 60);
    const blockedByOppositeBank = await state(page);
    expect(blockedByOppositeBank.serverPlayerPosition[0]).toBeLessThan(38);
    expect(blockedByOppositeBank.serverPlayerPosition[0]).toBeGreaterThan(36);
    expect(blockedByOppositeBank.serverPlayerPosition[0] - noJumpStart.serverPlayerPosition[0]).toBeLessThan(0.05);
    expect(blockedByOppositeBank.water.wading || blockedByOppositeBank.water.swimming).toBe(true);

    await page.keyboard.down('Space');
    try {
      const crossed = await waitForSnapshot(
        page,
        (value) =>
          value.serverPlayerPosition[0] > 38 &&
          value.onGround &&
          !value.water.wading &&
          !value.water.swimming &&
          !value.water.cameraSubmerged,
      );
      expect(crossed.colliding).toBe(false);
    } finally {
      await page.keyboard.up('Space');
    }
  } finally {
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyD');
  }
  await expect.poll(async () => (await audio(page)).underwaterFilterHz).toBeGreaterThan(12_000);
  const routeEvidence = await page.evaluate(() => {
    const target = window as unknown as NaturalEvidenceWindow;
    target.__naturalRouteSampling = false;
    return target.__naturalRouteFrames ?? [];
  });
  const audioBytes = await page.evaluate(
    async () => await (window as unknown as NaturalEvidenceWindow).__naturalAudioCapture!,
  );
  expect(audioBytes.length).toBeGreaterThan(0);
  expect(routeEvidence.length).toBeGreaterThan(30);
  expect(routeEvidence.some((frame) => frame.cameraSubmerged)).toBe(true);
  expect(routeEvidence.some((frame) => frame.bodyFraction > 0 && frame.bodyFraction < 1)).toBe(true);
  await testInfo.attach('natural-river-production-audio', {
    body: Buffer.from(audioBytes),
    contentType: 'audio/webm',
  });
  await testInfo.attach('natural-river-authority-trajectory', {
    body: JSON.stringify({ crossSection, routeEvidence, audio: await audio(page) }, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('natural-river-04-opposite-bank', { body: await page.screenshot(), contentType: 'image/png' });

  const fallingIds = await page.evaluate(async () => {
    const harness = window.__seedlandsHarness as unknown as HarnessApi;
    await harness.fillWorld({ from: [26, 17, -31], to: [30, 23, -29], voxel: 0 });
    await harness.setVoxelAt(27, 16, -30, 3);
    await harness.setVoxelAt(29, 16, -30, 3);
    const actor = await harness.executeGameplayCommand({
      type: 'spawn-actor',
      id: 'natural-bank-falling-grazer',
      archetype: 'grazer',
      position: [27.5, 17, -29.5],
    });
    const item = await harness.executeGameplayCommand({
      type: 'spawn-world-item',
      itemId: 'stone-block',
      count: 1,
      position: [29.5, 17, -29.5],
    });
    if (!actor.success) throw new Error(actor.error.message);
    if (!item.success) throw new Error(item.error.message);
    const player = harness.snapshot().serverPlayerPosition;
    const dx = 28.5 - player[0];
    const dz = -29.5 - player[2];
    harness.setView((Math.atan2(-dx, -dz) * 180) / Math.PI, -10);
    return {
      actorId: (actor.data as { entity: { id: string } }).entity.id,
      itemId: (item.data as { entity: { id: string } }).entity.id,
    };
  });
  await expect
    .poll(
      async () =>
        (await page.evaluate((id) => window.__seedlandsHarness!.authorityBody(id), fallingIds.actorId))?.grounded,
    )
    .toBe(true);
  await expect
    .poll(
      async () =>
        (await page.evaluate((id) => window.__seedlandsHarness!.authorityBody(id), fallingIds.itemId))?.grounded,
    )
    .toBe(true);
  const fallStart = await page.evaluate(({ actorId, itemId }) => {
    const target = window as unknown as NaturalEvidenceWindow;
    const harness = window.__seedlandsHarness as unknown as HarnessApi;
    target.__naturalFallFrames = [];
    target.__naturalFallSampling = true;
    const capture = () => {
      if (!target.__naturalFallSampling) return;
      target.__naturalFallFrames!.push({
        at: performance.now(),
        actor: harness.authorityBody(actorId),
        item: harness.authorityBody(itemId),
      });
      requestAnimationFrame(capture);
    };
    requestAnimationFrame(capture);
    return { actor: harness.authorityBody(actorId), item: harness.authorityBody(itemId) };
  }, fallingIds);
  try {
    await page.evaluate(async () => {
      const harness = window.__seedlandsHarness as unknown as HarnessApi;
      await harness.setVoxelAt(27, 16, -30, 0);
      await harness.setVoxelAt(29, 16, -30, 0);
    });
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              ({ actorId, itemId }) => ({
                actor: window.__seedlandsHarness!.authorityBody(actorId),
                item: window.__seedlandsHarness!.authorityBody(itemId),
              }),
              fallingIds,
            )
          ).actor?.velocity[1] ?? 0,
      )
      .toBeLessThan(-0.1);
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              ({ actorId, itemId }) => ({
                actor: window.__seedlandsHarness!.authorityBody(actorId),
                item: window.__seedlandsHarness!.authorityBody(itemId),
              }),
              fallingIds,
            )
          ).item?.velocity[1] ?? 0,
      )
      .toBeLessThan(-0.1);
    await testInfo.attach('natural-river-05-entity-midfall', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await expect
      .poll(
        async () =>
          (await page.evaluate((id) => window.__seedlandsHarness!.authorityBody(id), fallingIds.actorId))?.position[1],
      )
      .toBeLessThan(fallStart.actor!.position[1] - 1);
    await expect
      .poll(
        async () =>
          (await page.evaluate((id) => window.__seedlandsHarness!.authorityBody(id), fallingIds.itemId))?.position[1],
      )
      .toBeLessThan(fallStart.item!.position[1] - 1);
    const fallEvidence = await page.evaluate(() => {
      const target = window as unknown as NaturalEvidenceWindow;
      target.__naturalFallSampling = false;
      return target.__naturalFallFrames ?? [];
    });
    expect(fallEvidence.some(({ actor }) => (actor?.velocity[1] ?? 0) < 0)).toBe(true);
    expect(fallEvidence.some(({ item }) => (item?.velocity[1] ?? 0) < 0)).toBe(true);
    await testInfo.attach('natural-bank-entity-fall', {
      body: JSON.stringify({ fallingIds, fallStart, fallEvidence }, null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach('natural-river-06-entity-landed', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  } finally {
    await testInfo.attach('natural-bank-fall-final-state', {
      body: JSON.stringify({
        fallStart,
        frames: await page.evaluate(() => (window as unknown as NaturalEvidenceWindow).__naturalFallFrames ?? []),
      }),
      contentType: 'application/json',
    });
  }
});
