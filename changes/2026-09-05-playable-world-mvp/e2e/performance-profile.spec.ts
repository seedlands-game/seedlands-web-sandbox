import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { waitForSnapshot } from '../../../tests/e2e/support/harness';

test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, headless: false });
test('同机 1080p 画质分档与 Medium 重复采样', async ({ page, browser }, testInfo) => {
  test.skip(process.env.SEEDLANDS_PERFORMANCE_ACCEPTANCE !== '1', '性能窗口须显式安排独占 GPU。');
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const results = [];
  for (const quality of ['medium', 'medium', 'low', 'high'] as const) {
    await page.goto('./?harness=1');
    await page.locator('#quality').selectOption(quality);
    await page.locator('#seed').fill('seedlands-performance-reference');
    await page.getByRole('button', { name: '进入世界', exact: true }).click();
    await waitForSnapshot(
      page,
      (s) => s.generationQueue === 0 && s.meshingQueue === 0 && s.renderedChunks > 4 && s.onGround,
    );
    await page.bringToFront();
    const sample = await page.evaluate(async () => {
      const started = performance.now();
      let previous = started;
      const frames: number[] = [];
      let hiddenFrames = 0;
      await new Promise<void>((resolve) => {
        const frame = (now: number) => {
          if (now - started > 5000) frames.push(now - previous);
          if (document.visibilityState !== 'visible') hiddenFrames++;
          previous = now;
          if (now - started >= 30_000) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      frames.sort((a, b) => a - b);
      const p = (percent: number) => frames[Math.min(frames.length - 1, Math.floor(frames.length * percent))];
      const canvas = document.querySelector('canvas')!;
      return {
        count: frames.length,
        p50Ms: p(0.5),
        p95Ms: p(0.95),
        p99Ms: p(0.99),
        maxMs: frames.at(-1),
        hiddenFrames,
        dpr: devicePixelRatio,
        canvas: [canvas.width, canvas.height],
        snapshot: window.__seedlandsHarness!.snapshot(),
      };
    });
    expect(sample.hiddenFrames).toBe(0);
    expect(sample.count).toBeGreaterThan(100);
    results.push({ quality, ...sample });
    await page.screenshot({ path: testInfo.outputPath(`performance-${quality}-${results.length}.png`) });
    await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
    await page.getByRole('button', { name: '保存并返回主菜单' }).click();
  }
  const report = {
    sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    timestamp: new Date().toISOString(),
    browser: browser.version(),
    viewport: [1920, 1080],
    gpuDuration: 'NOT_COLLECTED',
    results,
    errors,
  };
  const path = testInfo.outputPath('performance-profile.json');
  writeFileSync(path, JSON.stringify(report, null, 2));
  await testInfo.attach('performance-profile', { path, contentType: 'application/json' });
  expect(errors).toEqual([]);
});
