import type { Page } from '@playwright/test';
import type { ClassicWindow } from './harness';

export type ArtifactReadback = Readonly<{
  ok: boolean;
  status: number;
  url: string;
  identity: Readonly<{
    schemaVersion?: number;
    sourceSha?: string;
    sourceDigest?: string;
    lockDigest?: string;
    artifactDigest?: string;
    builtAt?: string;
    files?: Readonly<Record<string, string>>;
  }> | null;
  error?: string;
}>;

export type PackLockReadback = Readonly<{
  ok: boolean;
  status: number;
  url: string;
  lock: Readonly<{
    schemaVersion: number;
    packs: readonly Readonly<{
      id: string;
      version: string;
      manifest: Readonly<{ path: string; sha256: string }>;
      entry: Readonly<{ path: string; sha256: string }>;
    }>[];
  }> | null;
  error?: string;
}>;

export type CompositionIdentity = Readonly<{
  version: number;
  playbookId: string;
  packLock: readonly Readonly<{ id: string; version: string }>[];
}>;

export type RuntimeEnvironment = Readonly<{
  userAgent: string;
  platform: string;
  hardwareConcurrency: number;
  viewport: Readonly<{ width: number; height: number }>;
  devicePixelRatio: number;
  webgl2: Readonly<{ renderer: string; vendor: string; version: string }> | null;
}>;

export const browserArtifact = (page: Page): Promise<ArtifactReadback> =>
  page.evaluate(async () => {
    const url = new URL('harness-artifact.json', document.baseURI).href;
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const text = await response.text();
      try {
        const identity = JSON.parse(text) as ArtifactReadback['identity'];
        return { ok: response.ok && identity?.schemaVersion === 1, status: response.status, url, identity };
      } catch {
        return { ok: false, status: response.status, url, identity: null, error: 'response-is-not-json' };
      }
    } catch (error) {
      return {
        ok: false,
        status: 0,
        url,
        identity: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

export const browserPackLock = (page: Page): Promise<PackLockReadback> =>
  page.evaluate(async () => {
    const url = new URL('packs/packs.lock.json', document.baseURI).href;
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const text = await response.text();
      try {
        const lock = JSON.parse(text) as PackLockReadback['lock'];
        return { ok: response.ok && lock?.schemaVersion === 1, status: response.status, url, lock };
      } catch {
        return { ok: false, status: response.status, url, lock: null, error: 'response-is-not-json' };
      }
    } catch (error) {
      return {
        ok: false,
        status: 0,
        url,
        lock: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

export async function compositionIdentity(page: Page): Promise<CompositionIdentity | null> {
  return page.evaluate(async () => {
    const result = await (window as unknown as ClassicWindow).__seedlandsHarness!.world.checkpoint({ kind: 'export' });
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    const data = result.data as {
      snapshot?: { gameplay?: { composition?: CompositionIdentity } };
    };
    return data.snapshot?.gameplay?.composition ?? null;
  });
}

export const runtimeEnvironment = (page: Page): Promise<RuntimeEnvironment> =>
  page.evaluate(() => {
    const context = document.querySelector<HTMLCanvasElement>('#game')?.getContext('webgl2');
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      webgl2: context
        ? {
            renderer: String(context.getParameter(context.RENDERER)),
            vendor: String(context.getParameter(context.VENDOR)),
            version: String(context.getParameter(context.VERSION)),
          }
        : null,
    };
  });
