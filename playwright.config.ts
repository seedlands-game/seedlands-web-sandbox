import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.platform === 'darwin' && existsSync(systemChrome) ? systemChrome : undefined;
const production = true;
const e2ePort = process.env.SEEDLANDS_E2E_PORT ?? (production ? '4273' : '4173');
const serverOrigin = `http://127.0.0.1:${e2ePort}`;
const basePath = process.env.SEEDLANDS_BASE_PATH ?? '/';
const baseURL = new URL(basePath, `${serverOrigin}/`).href;
const forceSwiftShader = process.env.SEEDLANDS_E2E_SWIFTSHADER === '1';

// Local acceptance must never create a native browser window or capture the host cursor.
// Chromium's new headless supports real Pointer Lock without a native window.
if (
  (process.env.PWDEBUG && process.env.PWDEBUG !== '0') ||
  process.env.SEEDLANDS_E2E_HEADED === '1' ||
  process.env.SEEDLANDS_E2E_ALLOW_HEADED === '1' ||
  process.env.SEEDLANDS_CHROME_PATH
) {
  throw new Error(
    'Classic acceptance requires bundled Chromium in headless mode; headed/debug/system Chrome overrides are disabled.',
  );
}

export default defineConfig({
  testDir: '.',
  testMatch: ['apps/web/tests/e2e/classic-runtime.spec.ts'],
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: true,
  reporter: [
    ['list', { printSteps: true }],
    ['html', { open: 'never' }],
  ],
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    viewport: { width: 960, height: 540 },
    headless: true,
    ...(executablePath ? {} : { channel: 'chromium' }),
    trace: 'retain-on-failure',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--mute-audio',
        ...(forceSwiftShader ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
      ],
    },
  },
  webServer: {
    command: `pnpm --filter @seedlands/web ${production ? 'preview' : 'dev'} --host 127.0.0.1 --port ${e2ePort} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI && !production && process.env.SEEDLANDS_E2E_REUSE_SERVER === '1',
    timeout: 30_000,
  },
  projects: [{ name: 'chromium' }],
});
