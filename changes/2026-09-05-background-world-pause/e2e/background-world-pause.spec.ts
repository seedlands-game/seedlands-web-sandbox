import { chromium, expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lockPointer, snapshot, waitForSnapshot } from '../../../tests/e2e/support/harness';

test('真实切后台停止声音与模拟，恢复前台不复活旧移动输入', async ({ baseURL }) => {
  test.setTimeout(60000);
  const profile = await mkdtemp(join(tmpdir(), 'seedlands-visibility-'));
  const process = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1282,800',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  try {
    let port = '';
    await expect
      .poll(async () => {
        try {
          port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
        } catch {
          port = '';
        }
        return port;
      })
      .toMatch(/^\d+$/);
    // 默认context不启用Playwright的强制焦点仿真，才能观察真实标签隐藏。
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
    const context = browser.contexts()[0];
    const page = context.pages()[0];
    await page.goto(new URL('?harness=1', baseURL!).href);
    const audio = () =>
      page.evaluate(() =>
        (
          window as unknown as {
            __seedlandsAudio: { snapshot(): { cue: string; voices: number; playedCount: number; rms: number } };
          }
        ).__seedlandsAudio.snapshot(),
      );
    await page.locator('#seed').fill('living-world-autonomy');
    await page.getByRole('button', { name: '进入世界', exact: true }).click();
    await waitForSnapshot(page, (s) => s.loadedChunks > 0 && s.onGround);
    await expect.poll(async () => (await audio()).cue, { timeout: 15000 }).not.toBe('');
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
    await lockPointer(page);
    await page.keyboard.down('KeyW');
    const foreground = await context.newPage();
    await foreground.goto('about:blank');
    await foreground.bringToFront();
    await expect.poll(() => page.evaluate(() => document.hidden)).toBe(true);
    await expect(page.getByRole('heading', { name: '旅途暂歇' })).toBeVisible();
    await expect.poll(async () => (await audio()).cue).toBe('');
    const paused = await snapshot(page);
    const soundCount = (await audio()).playedCount;
    await page.waitForTimeout(1800); // 已确认真实hidden和暂停后，采样不变性。
    expect((await snapshot(page))!.worldTime).toBe(paused!.worldTime);
    expect((await audio()).playedCount).toBe(soundCount);
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => document.hidden)).toBe(false);
    await expect(page.getByRole('heading', { name: '旅途暂歇' })).toBeVisible();
    expect((await audio()).cue).toBe('');
    await page.getByRole('button', { name: '继续游戏', exact: true }).click();
    await expect.poll(async () => (await snapshot(page))!.worldTime).toBeGreaterThan(paused!.worldTime);
    const restored = (await snapshot(page))!;
    await page.waitForTimeout(300); // 采样恢复后的旧W是否被清空。
    const stable = (await snapshot(page))!;
    expect(stable.player[0]).toBeCloseTo(restored.player[0], 2);
    expect(stable.player[2]).toBeCloseTo(restored.player[2], 2);
    await page.keyboard.up('KeyW');
    await foreground.close();
  } finally {
    if (browser) {
      const cdp = await browser.newBrowserCDPSession();
      await cdp.send('Browser.close').catch(() => {});
      await browser.close();
    }
    if (process.exitCode === null) process.kill('SIGTERM');
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
