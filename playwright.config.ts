import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.SEEDLANDS_CHROME_PATH ?? (existsSync(systemChrome) ? systemChrome : undefined);
const e2ePort = process.env.SEEDLANDS_E2E_PORT ?? '4173';
const serverOrigin = `http://127.0.0.1:${e2ePort}`;
const basePath = process.env.SEEDLANDS_BASE_PATH ?? '/';
const baseURL = new URL(basePath, `${serverOrigin}/`).href;

export default defineConfig({
  testDir: '.',
  testMatch: ['tests/e2e/**/*.spec.ts', 'changes/*/e2e/**/*.spec.ts'],
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL,
    viewport: { width: 1280, height: 720 },
    headless: true,
    trace: 'on-first-retry',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${e2ePort}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [{ name: 'chromium' }],
});
