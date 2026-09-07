import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { createServer, type Server } from 'node:http';
import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { pairedBootstrap, percentile } from '../../2026-09-07-data-plane-adoption/e2e/ab-statistics';
import type { Mode } from './simd-worker';
const enabled = process.env.SEEDLANDS_SIMD_AB === '1';
const change = resolve('changes/2026-09-06-data-plane-simd-policy');
const out = '/tmp/seedlands-simd-browser-bundle';
const runId = new Date().toISOString().replaceAll(/[:.]/g, '-');
const pairs = Number(process.env.SEEDLANDS_SIMD_PAIRS ?? 10);
const events = Number(process.env.SEEDLANDS_SIMD_EVENTS ?? 1000);
const warmupMs = Number(process.env.SEEDLANDS_SIMD_WARMUP_MS ?? 5000);
const cases = (
  process.env.SEEDLANDS_SIMD_CASES ??
  'occupancy-32768,uv-32768,uv-262144,colors-262144,indices-262144,mesh-natural,mesh-stress'
).split(',');
let server: Server;
let origin: string;
const compare = (a: number[], b: number[]) =>
  [...a, ...b].some((n) => n <= 0)
    ? {
        status: 'BELOW_TIMER_RESOLUTION',
        baseline: a.reduce((s, n) => s + n, 0) / a.length,
        candidate: b.reduce((s, n) => s + n, 0) / b.length,
      }
    : pairedBootstrap(a, b);
const bundleHashes: Record<string, string> = {};
test.use({ headless: true });
test.beforeAll(async () => {
  if (!enabled) return;
  await build({
    configFile: false,
    base: './',
    logLevel: 'warn',
    build: {
      outDir: out,
      emptyOutDir: true,
      target: 'es2022',
      minify: 'esbuild',
      sourcemap: true,
      lib: { entry: join(change, 'e2e/simd-entry.ts'), formats: ['es'], fileName: () => 'simd-entry.js' },
    },
  });
  for (const path of (await readdir(out, { recursive: true })).sort())
    if (/\.(js|wasm|map)$/.test(path))
      bundleHashes[path] = createHash('sha256')
        .update(await readFile(join(out, path)))
        .digest('hex');
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (path === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><title>Headless SIMD AB</title>');
        return;
      }
      const file = resolve(out, `.${path}`);
      if (!file.startsWith(`${out}/`)) {
        res.writeHead(403).end();
        return;
      }
      res.setHeader('Content-Type', extname(file) === '.wasm' ? 'application/wasm' : 'text/javascript');
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server binding failed');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
});
for (const name of cases)
  test(`scalar/SIMD ${name}`, async ({ page, browser }) => {
    test.skip(!enabled, '显式串行性能窗口');
    test.setTimeout(1_200_000);
    await page.goto(origin);
    const url = `${origin}/simd-entry.js`;
    const prepared = await page.evaluate(
      async ({ url, name }) => (await import(/* @vite-ignore */ url)).prepare(name),
      { url, name },
    );
    const meta = {
      name,
      runId,
      evidenceClass: pairs >= 10 && events >= 1000 && warmupMs >= 5000 ? 'formal' : 'smoke',
      pairs,
      events,
      warmupMs,
      headless: true,
      browser: browser.version(),
      sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      prepared,
      bundleHashes,
    };
    const runs: Array<{
      pair: number;
      mode: Mode;
      samples: Array<Record<string, number>>;
      cores: Array<{ coreMs: number }>;
    }> = [];
    const file = join(change, 'evidence', `simd-${name}-${runId}.json`);
    try {
      for (let pair = 0; pair < pairs; pair++) {
        const control: Mode = name.startsWith('mesh') ? 'staged' : 'ts';
        const order: Mode[] = pair % 2 ? ['simd', 'scalar', control] : [control, 'scalar', 'simd'];
        for (const mode of order) {
          const result = await page.evaluate(
            async (args) => (await import(/* @vite-ignore */ args.url)).sample(args.mode, args.warmupMs, args.events),
            { url, mode, warmupMs, events },
          );
          expect(result.samples).toHaveLength(events);
          runs.push({ pair, mode, ...result });
          await writeFile(`${file}.partial`, JSON.stringify({ ...meta, runs }));
        }
      }
      const metric = (mode: Mode, key: string, q: number) =>
        runs
          .filter((r) => r.mode === mode)
          .map((r) =>
            percentile(
              r.samples.map((s) => s[key]),
              q,
            ),
          );
      const means = (mode: Mode) =>
        runs
          .filter((r) => r.mode === mode)
          .map((r) => r.samples.reduce((n, s) => n + s.endToEndMs, 0) / r.samples.length);
      const comparisons =
        pairs < 2
          ? null
          : {
              scalarVsSimd: compare(metric('scalar', 'endToEndMs', 0.5), metric('simd', 'endToEndMs', 0.5)),
              p95: compare(metric('scalar', 'endToEndMs', 0.95), metric('simd', 'endToEndMs', 0.95)),
              p99: compare(metric('scalar', 'endToEndMs', 0.99), metric('simd', 'endToEndMs', 0.99)),
              compute: compare(metric('scalar', 'computeMs', 0.5), metric('simd', 'computeMs', 0.5)),
              meanEndToEnd: compare(means('scalar'), means('simd')),
              controlVsSimd: compare(
                metric(name.startsWith('mesh') ? 'staged' : 'ts', 'endToEndMs', 0.5),
                metric('simd', 'endToEndMs', 0.5),
              ),
              ...(name.startsWith('mesh')
                ? {
                    stagedVsSimd: compare(metric('staged', 'endToEndMs', 0.5), metric('simd', 'endToEndMs', 0.5)),
                  }
                : {
                    core: compare(
                      runs
                        .filter((r) => r.mode === 'scalar')
                        .map((r) => r.cores.reduce((n, c) => n + c.coreMs, 0) / r.cores.length),
                      runs
                        .filter((r) => r.mode === 'simd')
                        .map((r) => r.cores.reduce((n, c) => n + c.coreMs, 0) / r.cores.length),
                    ),
                  }),
            };
      const metricsStatus = {
        rss: 'NOT_COLLECTED: browser process RSS cannot isolate this co-resident Worker',
        gc: 'NOT_COLLECTED',
        memoryGrowth: 'fixed arena; no grow calls',
        boundary:
          'included in Worker compute with input/output copies; not independently subtracted below clock resolution',
      };
      const summaries = Object.fromEntries(
        [...new Set(runs.map((r) => r.mode))].map((mode) => {
          const samples = runs.filter((r) => r.mode === mode).flatMap((r) => r.samples);
          return [
            mode,
            Object.fromEntries(
              Object.keys(samples[0]).map((key) => [
                key,
                {
                  mean: samples.reduce((n, s) => n + s[key], 0) / samples.length,
                  p50: percentile(
                    samples.map((s) => s[key]),
                    0.5,
                  ),
                  p95: percentile(
                    samples.map((s) => s[key]),
                    0.95,
                  ),
                  p99: percentile(
                    samples.map((s) => s[key]),
                    0.99,
                  ),
                },
              ]),
            ),
          ];
        }),
      );
      await writeFile(
        file,
        JSON.stringify({ ...meta, status: 'completed', metricsStatus, comparisons, summaries }, null, 2),
      );
      await writeFile(`${file}.raw.gz`, gzipSync(JSON.stringify({ ...meta, runs })));
      await unlink(`${file}.partial`);
    } catch (error) {
      await writeFile(file, JSON.stringify({ ...meta, status: 'failed', error: String(error), runs }));
      throw error;
    } finally {
      await page.evaluate(async (url) => (await import(/* @vite-ignore */ url)).dispose(), url);
    }
  });
