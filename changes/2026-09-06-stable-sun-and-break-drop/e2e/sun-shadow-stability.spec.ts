import { expect, test } from '@playwright/test';
import {
  fillHarnessWorld,
  setHarnessView,
  setHarnessWorldTime,
  snapshot,
  waitForSnapshot,
} from '../../../tests/e2e/support/harness';

import {
  normalizeSunMotionSamples,
  normalizeSunMotionTailWindows,
  percentile,
  sampleGround,
  SUN_ANGLE_WINDOW_MAX_FRAMES,
  SUN_ANGLE_WINDOW_TIMEOUT_MS,
  SUN_DIRECTION_PROGRESS_RATIO_LIMIT,
  SUN_NEAR_ZERO_RAW_LIMIT,
  SUN_NORMALIZED_P95_LIMIT,
  SUN_TAIL_DIRECTION_SUPPORT_RADIANS,
  SUN_TAIL_NORMALIZED_MAX_LIMIT,
  SUN_TARGET_DIRECTION_TRAVEL_RADIANS,
} from './sun-shadow-sampling';

test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });

for (const quality of ['medium', 'high'] as const) {
  test(`${quality}太阳阴影连续帧稳定且实时更新`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.goto('./?harness=1', { waitUntil: 'networkidle' });
    await page.locator('#quality').selectOption(quality);
    await page.locator('#seed').fill('stable-sun-forest');
    await page.getByRole('button', { name: '进入世界' }).click();
    await page.locator('#start-card').waitFor({ state: 'hidden' });
    await waitForSnapshot(page, (value) => value.loadedChunks > 0);
    await fillHarnessWorld(page, [-15, 56, -20], [15, 56, 8], 1);
    await fillHarnessWorld(page, [-15, 57, -20], [15, 65, 8], 0);
    for (const x of [-8, -3, 3, 8]) {
      for (const z of [-14, -7]) {
        await fillHarnessWorld(page, [x, 57, z], [x, 60, z], 4);
        await fillHarnessWorld(page, [x - 2, 61, z - 2], [x + 2, 62, z + 2], 5);
      }
    }
    await page.evaluate(async () => {
      const h = (
        window as unknown as {
          __seedlandsHarness: { setSpectatorPosition(x: number, y: number, z: number): Promise<void> };
        }
      ).__seedlandsHarness;
      await h.setSpectatorPosition(0.5, 58.6, 3.5);
    });
    await setHarnessView(page, 0, -12);
    await setHarnessWorldTime(page, 14.93, true);
    await waitForSnapshot(
      page,
      (s) =>
        s.meshingQueue === 0 &&
        s.generationQueue === 0 &&
        s.deferredRemeshes === 0 &&
        s.performance.uploadQueueDepth === 0,
    );
    await testInfo.attach(`${quality}-before`, {
      body: JSON.stringify(await snapshot(page)),
      contentType: 'application/json',
    });
    for (const paused of process.env.SUN_METRICS_ONLY ? [] : [true, false]) {
      await setHarnessWorldTime(page, 14.93, paused);
      for (let frame = 0; frame < 12; frame += 1) {
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
        await testInfo.attach(`${quality}-${paused ? 'frozen' : 'running'}-${frame}`, {
          body: await page.locator('#game').screenshot(),
          contentType: 'image/png',
        });
      }
    }
    await setHarnessWorldTime(page, 14.93, false);
    const temporalWindow = await sampleGround(page, {
      kind: 'angle-window',
      targetDirectionAngleRadians: SUN_TARGET_DIRECTION_TRAVEL_RADIANS,
      maxFrames: SUN_ANGLE_WINDOW_MAX_FRAMES,
      timeoutMs: SUN_ANGLE_WINDOW_TIMEOUT_MS,
    });
    const temporal = temporalWindow.samples;
    const motion = normalizeSunMotionSamples(temporal);
    const tailWindows = normalizeSunMotionTailWindows(temporal);
    const movingMotion = motion.filter((sample) => sample.normalizedDifference !== null);
    const nearZeroMotion = motion.filter((sample) => sample.nearZero);
    const normalizedDifferences = movingMotion.map((sample) => sample.normalizedDifference!);
    const rawDifferences = motion.map((sample) => sample.rawDifference);
    const rafIntervals = temporal.slice(1).map((sample, index) => sample.rafAt - temporal[index].rafAt);
    const scanDurations = temporal.map((sample) => sample.readbackAndScanMs);
    const directionProgressRatio = movingMotion.length / Math.max(1, motion.length);
    const pairNormalizedDifferenceMax = normalizedDifferences.length > 0 ? Math.max(...normalizedDifferences) : null;
    const tailNormalizedDifferenceMax = Math.max(...tailWindows.map((window) => window.normalizedDifference));
    const peakNormalizedJump = temporalWindow.peakNormalizedJump;
    expect(peakNormalizedJump).not.toBeNull();
    const { beforePngDataUrl, afterPngDataUrl, ...peakNormalizedJumpMetadata } = peakNormalizedJump!;
    expect(pairNormalizedDifferenceMax).not.toBeNull();
    expect(peakNormalizedJumpMetadata.normalizedDifference).toBeCloseTo(pairNormalizedDifferenceMax!, 12);
    const decodePngDataUrl = (dataUrl: string) => {
      const prefix = 'data:image/png;base64,';
      if (!dataUrl.startsWith(prefix)) throw new Error('太阳阴影峰值附件不是 PNG data URL');
      return Buffer.from(dataUrl.slice(prefix.length), 'base64');
    };
    await testInfo.attach(`${quality}-peak-before`, {
      body: decodePngDataUrl(beforePngDataUrl),
      contentType: 'image/png',
    });
    await testInfo.attach(`${quality}-peak-after`, {
      body: decodePngDataUrl(afterPngDataUrl),
      contentType: 'image/png',
    });
    const temporalSummary = {
      sampleCount: temporal.length,
      cumulativeDirectionAngleRadians: temporalWindow.cumulativeDirectionAngleRadians,
      targetDirectionAngleRadians: temporalWindow.targetDirectionAngleRadians,
      reachedTarget: temporalWindow.reachedTarget,
      elapsedRafMs: temporalWindow.elapsedRafMs,
      elapsedWallMs: temporalWindow.elapsedWallMs,
      directionProgressRatio,
      nearZeroCount: nearZeroMotion.length,
      normalizedDifferenceP95: normalizedDifferences.length > 0 ? percentile(normalizedDifferences, 0.95) : null,
      normalizedDifferenceMax: pairNormalizedDifferenceMax,
      tailDirectionSupportRadians: SUN_TAIL_DIRECTION_SUPPORT_RADIANS,
      tailWindowCount: tailWindows.length,
      tailNormalizedDifferenceMax,
      peakNormalizedJump: peakNormalizedJumpMetadata,
      rawDifferenceP95: rawDifferences.length > 0 ? percentile(rawDifferences, 0.95) : null,
      rawDifferenceMax: rawDifferences.length > 0 ? Math.max(...rawDifferences) : null,
      rafIntervalP95Ms: rafIntervals.length > 0 ? percentile(rafIntervals, 0.95) : null,
      rafIntervalMaxMs: rafIntervals.length > 0 ? Math.max(...rafIntervals) : null,
      readbackAndScanP95Ms: percentile(scanDurations, 0.95),
      readbackAndScanMaxMs: Math.max(...scanDurations),
    };
    await testInfo.attach(`${quality}-temporal`, {
      body: JSON.stringify({
        ...temporalWindow,
        peakNormalizedJump: peakNormalizedJumpMetadata,
        tailWindows,
        summary: temporalSummary,
      }),
      contentType: 'application/json',
    });
    await setHarnessWorldTime(page, 14.93, true);
    await page.evaluate(async () => {
      for (let i = 0; i < 3; i += 1) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    const frozenWindow = await sampleGround(page, { kind: 'frames', frameCount: 36 });
    const frozen = frozenWindow.samples;
    await testInfo.attach(`${quality}-frozen-temporal`, {
      body: JSON.stringify(frozenWindow),
      contentType: 'application/json',
    });
    expect(Math.max(...frozen.map((frame) => frame.difference))).toBeLessThan(SUN_NEAR_ZERO_RAW_LIMIT);
    expect(temporalWindow.reachedTarget).toBe(true);
    expect(temporal.every((frame) => frame.error === 0 && frame.mean > 1)).toBe(true);
    expect(directionProgressRatio).toBeGreaterThan(SUN_DIRECTION_PROGRESS_RATIO_LIMIT);
    expect(nearZeroMotion.every((sample) => sample.rawDifference < SUN_NEAR_ZERO_RAW_LIMIT)).toBe(true);
    expect(temporalSummary.normalizedDifferenceP95).not.toBeNull();
    expect(temporalSummary.normalizedDifferenceP95!).toBeLessThan(SUN_NORMALIZED_P95_LIMIT);
    expect(tailWindows.length).toBeGreaterThan(0);
    expect(tailNormalizedDifferenceMax).toBeLessThan(SUN_TAIL_NORMALIZED_MAX_LIMIT);
    await testInfo.attach(`${quality}-occluder-before`, {
      body: await page.locator('#game').screenshot(),
      contentType: 'image/png',
    });
    await fillHarnessWorld(page, [-10, 57, -16], [10, 63, -5], 0);
    await waitForSnapshot(
      page,
      (value) => value.meshingQueue === 0 && value.deferredRemeshes === 0 && value.performance.uploadQueueDepth === 0,
    );
    await page.evaluate(async () => {
      for (let i = 0; i < 3; i += 1) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    const cleared = (await sampleGround(page, { kind: 'frames', frameCount: 12 })).samples;
    expect(cleared.every((frame) => frame.error === 0)).toBe(true);
    expect(cleared.at(-1)!.mean - frozen.at(-1)!.mean).toBeGreaterThan(2);
    await testInfo.attach(`${quality}-occluder-after`, {
      body: await page.locator('#game').screenshot(),
      contentType: 'image/png',
    });
    expect((await snapshot(page))?.visualEffects.sunShadows).toBe(true);
  });
}
