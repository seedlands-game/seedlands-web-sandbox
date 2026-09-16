import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const fullChromium = process.env.SEEDLANDS_E2E_FULL_CHROMIUM === '1';
const executablePath = fullChromium
  ? undefined
  : (process.env.SEEDLANDS_CHROME_PATH ?? (existsSync(systemChrome) ? systemChrome : undefined));
const production = true;
const e2ePort = process.env.SEEDLANDS_E2E_PORT ?? (production ? '4273' : '4173');
const serverOrigin = `http://127.0.0.1:${e2ePort}`;
const basePath = process.env.SEEDLANDS_BASE_PATH ?? '/';
const baseURL = new URL(basePath, `${serverOrigin}/`).href;
const forceSwiftShader = process.env.SEEDLANDS_E2E_SWIFTSHADER === '1';

export default defineConfig({
  testDir: '.',
  testMatch: ['apps/web/tests/e2e/classic-runtime.spec.ts'],
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: true,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL,
    viewport: { width: 1280, height: 720 },
    headless: true,
    ...(fullChromium ? { channel: 'chromium' as const } : {}),
    trace: 'on-first-retry',
    ...(executablePath || forceSwiftShader
      ? {
          launchOptions: {
            ...(executablePath ? { executablePath } : {}),
            ...(forceSwiftShader
              ? { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
              : {}),
          },
        }
      : {}),
  },
  webServer: {
    command: `pnpm --filter @seedlands/web ${production ? 'preview' : 'dev'} --host 127.0.0.1 --port ${e2ePort} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI && !production && process.env.SEEDLANDS_E2E_REUSE_SERVER === '1',
    timeout: 30_000,
  },
  projects: [{ name: 'chromium' }],
});
