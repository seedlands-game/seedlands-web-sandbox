import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pairedBootstrap, percentile } from './ab-statistics';
const enabled = process.env.SEEDLANDS_DATA_PLANE_AB === '1';
test('TS 复制与导航分项对照', async ({ page, browser }) => {
  test.skip(!enabled, '显式串行性能窗口');
  test.setTimeout(300000);
  const built = await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      write: false,
      target: 'es2022',
      minify: 'esbuild',
      lib: { entry: resolve('changes/2026-09-07-data-plane-adoption/e2e/data-plane-worker.ts'), formats: ['es'] },
    },
  });
  const bundles = Array.isArray(built) ? built : [built];
  const output = bundles.flatMap((b) => ('output' in b ? b.output : []));
  const chunk = output.find((c) => c.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing immutable worker bundle');
  const workerSource = chunk.code;
  await page.goto('/');
  const report: Record<string, unknown> = {
    headless: true,
    browser: browser.version(),
    sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    workerSha256: createHash('sha256').update(workerSource).digest('hex'),
    warmupMs: 1000,
    note: 'immutable production-minified worker; reported batch-averaged operation cost, not individual request tail',
    cases: {},
  };
  const cases: Record<string, unknown> = {};
  for (const kind of [
    'entity-5',
    'entity-129',
    'entity-513',
    'nav-validate-small',
    'nav-validate',
    'nav-search',
    'copy-baseline',
    'copy-generated',
  ]) {
    const result = await page.evaluate(
      async ({ kind, workerSource }) => {
        const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
        const worker = new Worker(workerUrl, { type: 'module' });
        const send = (mode: string, count: number) =>
          new Promise<{ elapsedMs: number; perOperationMs: number; checksum: number }>((resolve, reject) => {
            worker.onmessage = (e) => resolve(e.data);
            worker.onerror = (e) => reject(new Error(e.message));
            worker.postMessage({ mode, kind, count });
          });
        const count = kind === 'nav-validate' ? 10 : kind === 'nav-search' ? 50 : 100;
        for (const mode of ['original', 'fixed']) {
          const start = performance.now();
          do {
            await send(mode, count);
          } while (performance.now() - start < 1000);
        }
        const runs: { pair: number; mode: string; elapsedMs: number; perOperationMs: number; checksum: number }[] = [];
        for (let pair = 0; pair < 10; pair++)
          for (const mode of pair % 2 ? ['fixed', 'original'] : ['original', 'fixed']) {
            for (let sample = 0; sample < 20; sample++) runs.push({ pair, mode, ...(await send(mode, count)) });
          }
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        return { count, runs };
      },
      { kind, workerSource },
    );
    const metric = (mode: string) =>
      Array.from({ length: 10 }, (_, pair) => {
        const samples = result.runs.filter((r) => r.pair === pair && r.mode === mode);
        return samples.reduce((n, r) => n + r.perOperationMs, 0) / samples.length;
      });
    const summary = (mode: string) => {
      const values = result.runs.filter((r) => r.mode === mode).map((r) => r.perOperationMs);
      return {
        mean: values.reduce((a, b) => a + b, 0) / values.length,
        p50: percentile(values, 0.5),
        p95: percentile(values, 0.95),
        p99: percentile(values, 0.99),
      };
    };
    expect(result.runs).toHaveLength(400);
    console.log('Completed TS data plane case:', kind);
    cases[kind] = {
      ...result,
      original: summary('original'),
      fixed: summary('fixed'),
      comparison: pairedBootstrap(metric('original'), metric('fixed')),
    };
  }
  report.cases = cases;
  await mkdir('changes/2026-09-07-data-plane-adoption/evidence', { recursive: true });
  await writeFile(
    `changes/2026-09-07-data-plane-adoption/evidence/ts-fixes-${Date.now()}.json`,
    JSON.stringify(report, null, 2),
  );
});
