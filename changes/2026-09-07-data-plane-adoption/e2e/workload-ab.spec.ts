import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { WORKLOADS, type WorkloadId } from './workload-corpus';
import type { TaskSample } from './workload-entry';
import type { WorkloadMode } from './workload-worker';
import { pairedBootstrap as bootstrap, percentile } from './ab-statistics';

const pairedBootstrap = (a: number[], b: number[]) =>
  a.some((value) => value <= 0) ? { status: 'BELOW_TIMER_RESOLUTION' } : bootstrap(a, b);

const change = resolve('changes/2026-09-07-data-plane-adoption');
const out = '/tmp/seedlands-adoption-workload-bundle';
const pairs = Number(process.env.SEEDLANDS_WASM_PAIRS ?? 10);
const warmupMs = Number(process.env.SEEDLANDS_WASM_WARMUP_MS ?? 5000);
const eventCount = Number(process.env.SEEDLANDS_WASM_EVENTS ?? 30);
let server: Server;
let origin: string;
let bundleManifest: Record<string, string>;
const runId = new Date().toISOString().replaceAll(/[:.]/g, '-');
const enabled = process.env.SEEDLANDS_WASM_AB === '1';
test.use({ headless: true });
type Run = { pair: number; mode: WorkloadMode; samples: TaskSample[]; warmups: number; visibility: string };

test.beforeAll(async () => {
  if (!enabled) return;
  await build({
    configFile: false,
    base: './',
    logLevel: 'warn',
    build: {
      outDir: out,
      emptyOutDir: true,
      sourcemap: true,
      target: 'es2022',
      minify: 'esbuild',
      lib: { entry: join(change, 'e2e/workload-entry.ts'), formats: ['es'], fileName: () => 'workload-entry.js' },
    },
  });
  bundleManifest = {};
  for (const path of (await readdir(out, { recursive: true })).sort()) {
    if (!/\.(js|wasm|map)$/.test(path)) continue;
    bundleManifest[path] = createHash('sha256')
      .update(await readFile(join(out, path)))
      .digest('hex');
  }
  server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (path === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>Seedlands headless workload AB</title>');
        return;
      }
      const file = resolve(out, `.${path}`);
      if (!file.startsWith(`${out}/`)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      response.setHeader('Content-Type', extname(file) === '.wasm' ? 'application/wasm' : 'text/javascript');
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Benchmark server did not bind.');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
});

const selected = process.env.SEEDLANDS_WASM_WORKLOADS?.split(',') as WorkloadId[] | undefined;
for (const workload of selected ?? WORKLOADS)
  test(`headless ${workload} 分项与布局控制`, async ({ page, browser }) => {
    test.skip(!enabled, '显式分项性能窗口运行。');
    test.setTimeout(600000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(origin);
    const url = `${origin}/workload-entry.js`;
    const initialization = await page.evaluate(
      async ({ url, workload }) => (await import(/* @vite-ignore */ url)).prepareWorkload(workload),
      { url, workload },
    );
    const runs: Run[] = [];
    const file = join(change, 'evidence', `workload-${workload}-${runId}.json`);
    const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const rustHash = createHash('sha256')
      .update(await readFile(join(change, 'evidence/kernels-scalar.wasm')))
      .digest('hex');
    const meta = {
      workload,
      runId,
      sourceSha,
      rustHash,
      browser: browser.version(),
      headless: true,
      initialization,
      pairs,
      warmupMs,
      eventCount,
      fixtureSchema: 2,
      bundleManifest,
      protocol: 'one-existing-worker-equivalent; input clone + transfer + compute + output transfer',
      bodyBundleHash: createHash('sha256')
        .update(await readFile(join(out, 'workload-entry.js')))
        .digest('hex'),
    };
    await mkdir(join(change, 'evidence'), { recursive: true });
    try {
      for (let pair = 0; pair < pairs; pair += 1) {
        const modes: WorkloadMode[] = workload === 'w06' ? ['fixed', 'staged'] : ['ts', 'fixed', 'staged'];
        modes.push('rust');
        if (workload === 'w06' || workload.startsWith('w10')) modes.push('simd');
        const order = pair % 2 ? [...modes].reverse() : modes;
        for (const mode of order) {
          const result = await page.evaluate(
            async (args) =>
              (await import(/* @vite-ignore */ args.url)).sampleWorkload(
                args.workload,
                args.mode,
                args.warmupMs,
                args.eventCount,
              ),
            { url, workload, mode, warmupMs, eventCount },
          );
          runs.push({ pair, mode, ...result });
          expect(result.samples).toHaveLength(eventCount);
          await writeFile(`${file}.partial`, JSON.stringify({ ...meta, status: 'running', runs }));
        }
      }
      const metric = (mode: WorkloadMode, q: number, field: 'endToEndMs' | 'computeMs' | 'kernelMs' = 'endToEndMs') =>
        runs
          .filter((run) => run.mode === mode)
          .map((run) =>
            q < 0
              ? run.samples.reduce((sum, sample) => sum + sample[field], 0) / run.samples.length
              : percentile(
                  run.samples.map((sample) => sample[field]),
                  q,
                ),
          );
      const baselineMode = workload === 'w06' ? 'fixed' : 'ts';
      const baseline = metric(baselineMode, 0.5);
      const staged = metric('staged', 0.5);
      const comparisons =
        pairs >= 2
          ? {
              originalVsRust: pairedBootstrap(baseline, metric('rust', 0.5)),
              stagedVsRust: pairedBootstrap(staged, metric('rust', 0.5)),
              originalVsStaged: pairedBootstrap(baseline, staged),
              taskP95: pairedBootstrap(metric(baselineMode, 0.95), metric('rust', 0.95)),
              computeP50: pairedBootstrap(metric(baselineMode, 0.5, 'computeMs'), metric('rust', 0.5, 'computeMs')),
              ...(workload === 'w06' || workload.startsWith('w10')
                ? { rustVsSimd: pairedBootstrap(metric('rust', 0.5), metric('simd', 0.5)) }
                : {}),
            }
          : null;
      await writeFile(file, JSON.stringify({ ...meta, status: 'completed', comparisons, runs }, null, 2));
      await writeFile(`${file}.raw.gz`, gzipSync(JSON.stringify({ ...meta, runs })));
      await rm(`${file}.partial`, { force: true });
    } catch (error) {
      await writeFile(file, JSON.stringify({ ...meta, status: 'failed', error: String(error), runs }, null, 2));
      throw error;
    } finally {
      await page
        .evaluate(async (url) => (await import(/* @vite-ignore */ url)).disposeWorkload(), url)
        .catch(() => undefined);
    }
  });
