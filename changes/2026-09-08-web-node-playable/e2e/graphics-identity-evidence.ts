import { basename, resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import type { GraphicsIdentitySnapshot } from './graphics-identity-probe';
import { journeyQuality } from './journey-quality';

const origin = `http://127.0.0.1:${process.env.SEEDLANDS_E2E_PORT ?? '4173'}`;
const basePath = process.env.SEEDLANDS_BASE_PATH ?? '/';
const probePath = new URL(
  `@fs${resolve('changes/2026-09-08-web-node-playable/e2e/graphics-identity-probe.ts')}`,
  new URL(basePath, `${origin}/`),
).pathname;

export type ConnectionGraphicsIdentity = Readonly<
  GraphicsIdentitySnapshot & {
    attempt: string;
    outcome: 'connected' | 'connection-failure';
    browserVersion: string;
    requestedQuality: string;
    browserUserAgent: string;
    configuredChannel: string;
    executableSource: string;
  }
>;

export async function captureGraphicsIdentity(
  page: Page,
  testInfo: TestInfo,
  attempt: string,
  outcome: ConnectionGraphicsIdentity['outcome'],
): Promise<ConnectionGraphicsIdentity> {
  const graphics = await page.evaluate(
    async (path) => ((await import(path)) as typeof import('./graphics-identity-probe')).readGraphicsIdentity(),
    probePath,
  );
  if (!graphics) throw new Error('PlayCanvas WebGL2 graphics identity is unavailable.');
  const identity = {
    ...graphics,
    requestedQuality: journeyQuality,
    attempt,
    outcome,
    browserVersion: page.context().browser()?.version() ?? 'UNAVAILABLE',
    browserUserAgent: await page.evaluate(() => navigator.userAgent),
    configuredChannel: testInfo.project.use.channel ?? 'unspecified',
    executableSource: testInfo.project.use.launchOptions?.executablePath
      ? basename(testInfo.project.use.launchOptions.executablePath)
      : 'playwright-managed',
  } as const;
  await testInfo.attach(`${attempt}-graphics-identity`, {
    body: Buffer.from(`${JSON.stringify(identity, null, 2)}\n`),
    contentType: 'application/json',
  });
  return identity;
}

export async function armGraphicsIdentity(page: Page): Promise<void> {
  await page.evaluate(
    async (path) => ((await import(path)) as typeof import('./graphics-identity-probe')).armGraphicsIdentity(),
    probePath,
  );
}

export async function hasCurrentApplication(page: Page): Promise<boolean> {
  return page.evaluate(
    async (path) => ((await import(path)) as typeof import('./graphics-identity-probe')).hasCurrentApplication(),
    probePath,
  );
}

export async function releaseGraphicsIdentity(page: Page): Promise<void> {
  await page
    .evaluate(
      async (path) => ((await import(path)) as typeof import('./graphics-identity-probe')).releaseGraphicsIdentity(),
      probePath,
    )
    .catch(() => undefined);
}
