import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { HarnessApi } from '../../../src/app/game-harness';
import { Voxel } from '../../../src/world/voxel';
import { lockPointer, snapshot, waitForSnapshot } from '../../../tests/e2e/support/harness';

type NaturalSunState = Readonly<{
  direction: [number, number, number];
  screen: [number, number] | null;
  facing: boolean;
  presentedWorldTime: number;
  shadowCascades: number;
  shadowResolution: number;
}>;

type NaturalSunHarness = Omit<HarnessApi, 'sunSnapshot' | 'setTimePaused' | 'setTimeSpeed'> & {
  sunSnapshot(): NaturalSunState;
  setTimePaused(paused: boolean): Promise<void>;
  setTimeSpeed(speed: number): Promise<void>;
};

type SunFrame = Readonly<{
  at: number;
  direction: [number, number, number];
  presentedWorldTime: number;
}>;

const quantile = (values: readonly number[], q: number): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? 0;
};

const sunState = (page: Page) =>
  page.evaluate(() => (window.__seedlandsHarness as unknown as NaturalSunHarness).sunSnapshot());

const waitForRenderIdle = (page: Page) =>
  waitForSnapshot(
    page,
    (value) =>
      value.generationQueue === 0 &&
      value.meshingQueue === 0 &&
      value.deferredRemeshes === 0 &&
      value.performance.uploadQueueDepth === 0,
  );

const sampleSunFrames = (page: Page, count: number) =>
  page.evaluate(
    (frameCount) =>
      new Promise<SunFrame[]>((resolve) => {
        const frames: SunFrame[] = [];
        const capture = (at: number) => {
          const sun = (window.__seedlandsHarness as unknown as NaturalSunHarness).sunSnapshot();
          frames.push({ at, direction: [...sun.direction], presentedWorldTime: sun.presentedWorldTime });
          if (frames.length >= frameCount) resolve(frames);
          else requestAnimationFrame(capture);
        };
        requestAnimationFrame(capture);
      }),
    count,
  );

async function attachRawFrames(page: Page, testInfo: TestInfo, prefix: string, count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await testInfo.attach(`${prefix}-${String(frame).padStart(2, '0')}`, {
      body: await page.locator('#game').screenshot(),
      contentType: 'image/png',
    });
  }
}

const directionDistance = (left: readonly number[], right: readonly number[]) =>
  Math.hypot(left[0]! - right[0]!, left[1]! - right[1]!, left[2]! - right[2]!);

test.use({ video: 'on', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });

for (const quality of ['medium', 'high'] as const) {
  test(`${quality}天然森林的静止、昼夜推进和真实移动保留连续主阴影`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    const webglErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /(?:WebGL|GL_INVALID|GL_OUT_OF_MEMORY)/i.test(message.text()))
        webglErrors.push(message.text());
    });

    await page.goto('./?harness=1', { waitUntil: 'networkidle' });
    await page.locator('#quality').selectOption(quality);
    await page.locator('#seed').fill('mosslight-68');
    await page.getByRole('button', { name: '进入世界' }).click();
    await page.locator('#start-card').waitFor({ state: 'hidden' });
    await waitForSnapshot(page, (value) => value.loadedChunks > 0);
    await page.evaluate(async () => {
      const harness = window.__seedlandsHarness as unknown as NaturalSunHarness;
      await harness.movePlayerTo(28.5, 19.6, -22.5);
      harness.setView(0, -12);
      await harness.setTimeSpeed(1);
      await harness.setWorldTime(14.93);
      await harness.setTimePaused(true);
    });
    await waitForSnapshot(
      page,
      (value) =>
        value.onGround &&
        !value.colliding &&
        Math.abs(value.serverPlayerPosition[0] - 28.5) < 0.01 &&
        Math.abs(value.serverPlayerPosition[1] - 19.6) < 0.01 &&
        Math.abs(value.serverPlayerPosition[2] + 22.5) < 0.01,
    );
    await waitForRenderIdle(page);

    const geometry = await page.evaluate(() => {
      const harness = window.__seedlandsHarness as unknown as NaturalSunHarness;
      return {
        playerGround: harness.getVoxelAt?.(28, 17, -22),
        playerFeet: harness.getVoxelAt?.(28, 18, -22),
        playerHead: harness.getVoxelAt?.(28, 19, -22),
        treeGround: harness.getVoxelAt?.(28, 17, -27),
        lowerTrunk: harness.getVoxelAt?.(28, 18, -27),
        upperTrunk: harness.getVoxelAt?.(28, 21, -27),
        canopy: harness.getVoxelAt?.(28, 20, -25),
        canopyTop: harness.getVoxelAt?.(28, 23, -27),
      };
    });
    expect(geometry).toEqual({
      playerGround: Voxel.Grass,
      playerFeet: Voxel.Air,
      playerHead: Voxel.Air,
      treeGround: Voxel.Grass,
      lowerTrunk: Voxel.Wood,
      upperTrunk: Voxel.Wood,
      canopy: Voxel.Leaves,
      canopyTop: Voxel.Leaves,
    });

    const frozenStart = (await snapshot(page))!;
    const frozenPlayer = frozenStart.serverPlayerPosition;
    const frozenFrames = await sampleSunFrames(page, 90);
    const frozenAfter = (await snapshot(page))!;
    expect(frozenAfter.serverPlayerPosition).toEqual(frozenPlayer);
    expect(frozenAfter.timePaused).toBe(true);
    expect(frozenAfter.visualEffects.reflectionEnabled).toBe(true);
    expect(frozenAfter.visualEffects.reflectionActive).toBe(true);
    expect(frozenAfter.visualEffects.reflectionRenderCount).toBeGreaterThan(
      frozenStart.visualEffects.reflectionRenderCount,
    );
    expect(
      Math.max(
        ...frozenFrames.map(({ presentedWorldTime }) =>
          Math.abs(presentedWorldTime - frozenFrames[0]!.presentedWorldTime),
        ),
      ),
    ).toBeLessThan(1e-8);
    expect(
      Math.max(
        ...frozenFrames
          .slice(1)
          .map((frame, index) => directionDistance(frame.direction, frozenFrames[index]!.direction)),
      ),
    ).toBeLessThan(1e-8);
    await attachRawFrames(page, testInfo, `${quality}-natural-frozen`, 8);

    await page.evaluate(() => (window.__seedlandsHarness as unknown as NaturalSunHarness).setTimePaused(false));
    const runningPlayer = (await snapshot(page))!.serverPlayerPosition;
    const runningFrames = await sampleSunFrames(page, 240);
    const runningAfter = (await snapshot(page))!;
    const frameDeltas = runningFrames.slice(1).map((frame, index) => frame.at - runningFrames[index]!.at);
    const timeDeltas = runningFrames
      .slice(1)
      .map((frame, index) => frame.presentedWorldTime - runningFrames[index]!.presentedWorldTime);
    const directionDeltas = runningFrames
      .slice(1)
      .map((frame, index) => directionDistance(frame.direction, runningFrames[index]!.direction));
    const frameCost = {
      count: frameDeltas.length,
      p50Ms: quantile(frameDeltas, 0.5),
      p95Ms: quantile(frameDeltas, 0.95),
      maxMs: Math.max(...frameDeltas),
    };
    expect(runningAfter.serverPlayerPosition).toEqual(runningPlayer);
    expect(runningAfter.timePaused).toBe(false);
    expect(timeDeltas.filter((delta) => delta > 0).length / timeDeltas.length).toBeGreaterThan(0.9);
    expect(Math.min(...timeDeltas)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...directionDeltas)).toBeLessThan(0.001);
    expect(frameCost.p95Ms).toBeLessThanOrEqual(20);
    expect(frameCost.maxMs).toBeLessThanOrEqual(1000 / 30);
    await attachRawFrames(page, testInfo, `${quality}-natural-running`, 8);

    await page.evaluate(() => (window.__seedlandsHarness as unknown as NaturalSunHarness).setTimePaused(true));
    await page.bringToFront();
    const canvas = await lockPointer(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('天然森林画布没有可用尺寸。');
    const beforeTurn = await sunState(page);
    for (let step = 1; step <= 24; step += 1) {
      await page.mouse.move(box.x + box.width / 2 + step * 2, box.y + box.height / 2);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      if (step % 6 === 0)
        await testInfo.attach(`${quality}-natural-turn-${step / 6}`, {
          body: await page.locator('#game').screenshot(),
          contentType: 'image/png',
        });
    }
    const afterTurn = await sunState(page);
    expect(await page.evaluate(() => document.pointerLockElement?.id)).toBe('game');
    expect(beforeTurn.screen).not.toBeNull();
    expect(afterTurn.screen).not.toBeNull();
    expect(
      Math.hypot(afterTurn.screen![0] - beforeTurn.screen![0], afterTurn.screen![1] - beforeTurn.screen![1]),
    ).toBeGreaterThan(8);
    expect(directionDistance(afterTurn.direction, beforeTurn.direction)).toBeLessThan(1e-8);

    const beforeMove = (await snapshot(page))!.serverPlayerPosition;
    await page.keyboard.down('KeyD');
    try {
      await page.waitForFunction(
        ([x, z]) => {
          const current = (window.__seedlandsHarness as unknown as NaturalSunHarness).snapshot();
          return Math.hypot(current.serverPlayerPosition[0] - x, current.serverPlayerPosition[2] - z) > 0.8;
        },
        [beforeMove[0], beforeMove[2]],
      );
    } finally {
      await page.keyboard.up('KeyD');
    }
    const afterMove = await waitForSnapshot(page, (value) => value.onGround && !value.colliding);
    expect(
      Math.hypot(afterMove.serverPlayerPosition[0] - beforeMove[0], afterMove.serverPlayerPosition[2] - beforeMove[2]),
    ).toBeGreaterThan(0.8);
    expect((await sunState(page)).presentedWorldTime).toBeCloseTo(afterTurn.presentedWorldTime, 8);
    await testInfo.attach(`${quality}-natural-after-pointer-move`, {
      body: await page.locator('#game').screenshot(),
      contentType: 'image/png',
    });

    await page.evaluate(async () => {
      const harness = window.__seedlandsHarness as unknown as NaturalSunHarness;
      await harness.movePlayerTo(28.5, 19.6, -22.5);
      harness.setView(0, -12);
    });
    await waitForSnapshot(page, (value) => value.onGround && !value.colliding);
    const occluderBefore = (await snapshot(page))!;
    await testInfo.attach(`${quality}-natural-occluder-before`, {
      body: await page.locator('#game').screenshot(),
      contentType: 'image/png',
    });
    await page.evaluate(async (air) => {
      const harness = window.__seedlandsHarness as unknown as NaturalSunHarness;
      await harness.setVoxelAt(28, 20, -25, air);
    }, Voxel.Air);
    const occluderAfter = await waitForSnapshot(
      page,
      (value) => value.meshingQueue === 0 && value.deferredRemeshes === 0 && value.performance.uploadQueueDepth === 0,
    );
    expect(occluderAfter.worldRevision).toBeGreaterThan(occluderBefore.worldRevision);
    expect(
      await page.evaluate(() => (window.__seedlandsHarness as unknown as NaturalSunHarness).getVoxelAt?.(28, 20, -25)),
    ).toBe(Voxel.Air);
    await testInfo.attach(`${quality}-natural-occluder-after`, {
      body: await page.locator('#game').screenshot(),
      contentType: 'image/png',
    });

    const finalSun = await sunState(page);
    const finalSnapshot = (await snapshot(page))!;
    expect(finalSnapshot.visualEffects.sunShadows).toBe(true);
    expect(finalSun.shadowCascades).toBe(3);
    expect(finalSun.shadowResolution).toBe(quality === 'medium' ? 512 : 1024);
    expect(pageErrors).toEqual([]);
    expect(webglErrors).toEqual([]);
    await testInfo.attach(`${quality}-natural-sun-summary`, {
      body: JSON.stringify(
        {
          sourceSha: process.env.SEEDLANDS_E2E_SOURCE_SHA ?? 'UNSPECIFIED',
          quality,
          geometry,
          frameCost,
          frozen: {
            frameCount: frozenFrames.length,
            presentedStart: frozenFrames[0]!.presentedWorldTime,
            presentedEnd: frozenFrames.at(-1)!.presentedWorldTime,
          },
          running: {
            frameCount: runningFrames.length,
            presentedStart: runningFrames[0]!.presentedWorldTime,
            presentedEnd: runningFrames.at(-1)!.presentedWorldTime,
            maxDirectionStep: Math.max(...directionDeltas),
          },
          pointerMotion: { beforeTurn, afterTurn, beforeMove, afterMove: afterMove.serverPlayerPosition },
          occluder: {
            beforeRevision: occluderBefore.worldRevision,
            afterRevision: occluderAfter.worldRevision,
            position: [28, 20, -25],
          },
          render: {
            sunShadows: finalSnapshot.visualEffects.sunShadows,
            shadowCascades: finalSun.shadowCascades,
            shadowResolution: finalSun.shadowResolution,
            reflectionActive: frozenAfter.visualEffects.reflectionActive,
            reflectionFramesDuringFrozen:
              frozenAfter.visualEffects.reflectionRenderCount - frozenStart.visualEffects.reflectionRenderCount,
          },
          semanticBoundary:
            'Playwright证明天然几何、时钟连续、真实PointerLock输入、World.edit响应和不读取像素的帧成本；阴影是否自然稳定由同次视频、连续PNG与Midscene判断。',
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });
}
