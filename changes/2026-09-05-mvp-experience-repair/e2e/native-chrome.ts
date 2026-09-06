import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 独立临时profile；关闭自动焦点仿真，真实可见窗口承担最终性能采样。 */
export async function launchNativeChrome() {
  const profile = await mkdtemp(join(tmpdir(), 'seedlands-native-performance-'));
  const browserProcess = spawn(
    process.env.SEEDLANDS_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--force-device-scale-factor=1',
      '--window-size=1922,1160',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  const close = async () => {
    if (browser?.isConnected()) {
      const cdp = await browser.newBrowserCDPSession();
      await cdp.send('Browser.close').catch(() => {});
      await browser.close();
    }
    if (browserProcess.exitCode === null) browserProcess.kill('SIGTERM');
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
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
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
    const page = browser.contexts()[0].pages()[0];
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.bringToFront();
    return { browser, page, close };
  } catch (error) {
    await close();
    throw error;
  }
}
