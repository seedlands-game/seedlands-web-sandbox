import { runNaturalJourney } from './natural-journey-flow';
import type { GlobalAudio } from '../../../src/app/audio/global-audio';
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { lockPointer, snapshot, waitForSnapshot } from '../../../tests/e2e/support/harness';

test('60分钟真实输入、跨区、背包、存退继续与死亡恢复混合稳定性', async ({ page, context }, testInfo) => {
  test.skip(process.env.SEEDLANDS_SOAK_ACCEPTANCE !== '1', '60分钟验收须独占指定生产构建并显式执行。');
  page.setDefaultTimeout(10_000);
  let stage = 'initializing';
  const seconds = Number(process.env.SEEDLANDS_SOAK_SECONDS ?? 3600);
  test.setTimeout((seconds + 180) * 1000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const source =
    process.env.SEEDLANDS_SOAK_SOURCE ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const records: unknown[] = [];
  const centers = new Set<string>();
  const heaps: number[] = [];
  let recoveries = 0;
  let sessions = 1;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const start = Date.now();
  const reportPath = process.env.SEEDLANDS_SOAK_REPORT ?? testInfo.outputPath('mixed-soak.json');
  const checkpoint = () =>
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          source,
          stage,
          requestedSeconds: seconds,
          elapsedSeconds: (Date.now() - start) / 1000,
          recoveries,
          sessions,
          visitedCenters: [...centers],
          errors,
          records,
        },
        null,
        2,
      ),
    );
  try {
    stage = 'natural-resource-crafting-building-combat-food-save-journey';
    checkpoint();
    await runNaturalJourney(page, testInfo);
    await page.getByRole('button', { name: '关闭背包', exact: true }).click();
    await lockPointer(page);
    let cycle = 0;
    while (Date.now() - start < seconds * 1000) {
      stage = `movement-cycle-${cycle}`;
      checkpoint();
      const key = ['KeyW', 'KeyD', 'KeyS', 'KeyA'][cycle % 4];
      await page.keyboard.down(key);
      // 持续输入为负载，不以等待时间作为行为正确性断言。
      for (let segment = 0; segment < 3 && Date.now() - start < seconds * 1000; segment++) {
        await page.waitForTimeout(Math.min(15_000, seconds * 1000 - (Date.now() - start)));
        const state = await snapshot(page);
        if (state) centers.add(state.streamCenter.join(','));
        if (await page.getByRole('button', { name: '复活', exact: true }).isVisible()) {
          await page.keyboard.up(key);
          stage = 'death-recovery';
          checkpoint();
          await page.getByRole('button', { name: '复活', exact: true }).click();
          await expect(page.getByRole('dialog', { name: '你倒下了', exact: true })).toBeHidden();
          await waitForSnapshot(page, (s) => s.onGround && !s.colliding);
          recoveries++;
          await lockPointer(page);
          await page.keyboard.down(key);
        } else if (state?.onGround) {
          await page.keyboard.down('Space');
          await page.waitForTimeout(150);
          await page.keyboard.up('Space');
        }
      }
      await page.keyboard.up(key);
      if (cycle % 4 === 0) {
        stage = 'real-mining-placement-input';
        checkpoint();
        await page.keyboard.press('Digit1');
        await page.evaluate(() => window.__seedlandsHarness!.setView(0, -40));
        await page.mouse.down();
        await page.waitForTimeout(1700);
        await page.mouse.up();
        await page.mouse.click(640, 360, { button: 'right' });
        await page.evaluate(() => window.__seedlandsHarness!.setView(0, 0));
      }
      stage = 'inventory-and-session';
      checkpoint();
      await page.keyboard.press('KeyE');
      await expect(page.getByRole('dialog', { name: '背包与合成' })).toBeVisible();
      await page.getByRole('button', { name: '关闭背包' }).click();
      if (cycle % 5 === 4) {
        await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
        await page.getByRole('button', { name: '保存并返回主菜单' }).click();
        await expect.poll(() => page.workers().length).toBeLessThanOrEqual(1);
        await page.getByRole('button', { name: '继续世界', exact: true }).click();
        await waitForSnapshot(page, (s) => s.onGround && !s.colliding);
        sessions++;
        await cdp.send('HeapProfiler.collectGarbage');
      }
      const state = await snapshot(page);
      const metrics = await cdp.send('Performance.getMetrics');
      const heap = metrics.metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? 0;
      if (cycle % 5 === 4) heaps.push(heap);
      records.push({
        elapsedSeconds: (Date.now() - start) / 1000,
        state,
        heap,
        workers: page.workers().length,
        dom: await cdp.send('Memory.getDOMCounters'),
        audio: await page.evaluate(() =>
          (
            window as unknown as { __seedlandsAudio?: { snapshot: () => ReturnType<GlobalAudio['snapshot']> } }
          ).__seedlandsAudio?.snapshot(),
        ),
      });
      checkpoint();
      expect(errors).toEqual([]);
      expect(state!.loadedChunks).toBeLessThan(300);
      expect(page.workers().length).toBeLessThanOrEqual(3);
      console.log(
        `稳定性 ${Math.round((Date.now() - start) / 60000)} 分钟；跨区 ${centers.size}；会话 ${sessions}；恢复 ${recoveries}`,
      );
      await lockPointer(page);
      cycle++;
    }
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '保存并返回主菜单' }).click();
    await expect.poll(() => page.workers().length).toBeLessThanOrEqual(1);
    checkpoint();
    await testInfo.attach('mixed-soak', { path: reportPath, contentType: 'application/json' });
    expect(centers.size).toBeGreaterThanOrEqual(seconds >= 3600 ? 4 : 1);
    if (heaps.length >= 4) expect(heaps.at(-1)! - heaps[1]).toBeLessThan(30 * 1024 * 1024);
    expect(errors).toEqual([]);
    stage = 'completed';
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    await page.screenshot({ path: testInfo.outputPath('soak-failure.png') }).catch(() => undefined);
    throw error;
  } finally {
    checkpoint();
    await testInfo.attach('final-soak-checkpoint', { path: reportPath, contentType: 'application/json' });
  }
});
