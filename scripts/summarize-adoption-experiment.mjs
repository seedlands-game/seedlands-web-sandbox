import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const directory = resolve(import.meta.dirname, '../harness/results/adoption');
const average = (values) => values.reduce((s, v) => s + v, 0) / values.length;
const percentile = (values, q) => {
  const a = [...values].sort((x, y) => x - y);
  const p = (a.length - 1) * q;
  const lo = Math.floor(p);
  return a[lo] + (a[Math.ceil(p)] - a[lo]) * (p - lo);
};
const compare = (a, b) => {
  if (a.length < 2 || a.length !== b.length || average(a) <= 0) return { status: 'UNRESOLVED' };
  let seed = 123456;
  const values = [];
  for (let n = 0; n < 10000; n++) {
    let x = 0,
      y = 0;
    for (let i = 0; i < a.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const at = Math.floor((seed / 2 ** 32) * a.length);
      x += a[at];
      y += b[at];
    }
    if (x > 0) values.push((1 - y / x) * 100);
  }
  return {
    baselineMs: average(a),
    candidateMs: average(b),
    savedMs: average(a) - average(b),
    improvementPercent: (1 - average(b) / average(a)) * 100,
    ci95: [percentile(values, 0.025), percentile(values, 0.975)],
  };
};
const workloads = {};
for (const file of readdirSync(directory)
  .filter((f) => /^workload-.*\.json$/.test(f))
  .sort()) {
  const d = JSON.parse(readFileSync(resolve(directory, file), 'utf8'));
  if (d.status !== 'completed' || d.pairs !== 10) continue;
  const runs = d.runs;
  const modes = [...new Set(runs.map((r) => r.mode))];
  const metric = (mode, field, q) =>
    runs
      .filter((r) => r.mode === mode)
      .sort((a, b) => a.pair - b.pair)
      .map((r) =>
        q === undefined
          ? average(r.samples.map((s) => s[field]))
          : percentile(
              r.samples.map((s) => s[field]),
              q,
            ),
      );
  const metrics = {};
  for (const mode of modes) {
    metrics[mode] = {};
    for (const field of ['computeMs', 'endToEndMs', 'prepareMs', 'roundtripMs', 'kernelMs'])
      metrics[mode][field] = {
        mean: average(metric(mode, field)),
        p50: average(metric(mode, field, 0.5)),
        p95: average(metric(mode, field, 0.95)),
        p99: average(metric(mode, field, 0.99)),
      };
  }
  const comparisons = {};
  for (const [a, b] of [
    ['ts', 'fixed'],
    ['fixed', 'rust'],
    ['staged', 'rust'],
    ['fixed', 'moonbit'],
    ['fixed', 'simd'],
    ['rust', 'simd'],
  ])
    if (modes.includes(a) && modes.includes(b))
      comparisons[a + 'To' + b] = {
        compute: compare(metric(a, 'computeMs'), metric(b, 'computeMs')),
        task: compare(metric(a, 'endToEndMs'), metric(b, 'endToEndMs')),
        p95: compare(metric(a, 'endToEndMs', 0.95), metric(b, 'endToEndMs', 0.95)),
        p99: compare(metric(a, 'endToEndMs', 0.99), metric(b, 'endToEndMs', 0.99)),
      };
  workloads[d.workload] = {
    file,
    runId: d.runId,
    sourceSha: d.sourceSha,
    rustHash: d.rustHash,
    browser: d.browser,
    pairs: d.pairs,
    eventCount: d.eventCount,
    warmupMs: d.warmupMs,
    metrics,
    comparisons,
  };
}
const report = {
  generatedAt: new Date().toISOString(),
  semantics:
    'headless one Worker, 10 paired blocks; tail is mean of within-run percentiles; core includes ABI validation; TS uninstrumented kernel zero means NOT_COLLECTED',
  workloads,
};
writeFileSync(resolve(directory, 'workload-summary.json'), JSON.stringify(report, null, 2) + '\n');
const rows = [
  '| 负载 | 原 TS 计算 ms | 修复 TS 计算 ms | 同布局 TS 计算 ms | Rust 计算 ms | MoonBit 计算 ms | Rust SIMD 计算 ms |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
];
for (const [id, d] of Object.entries(workloads)) {
  const f = (m) => d.metrics[m]?.computeMs.mean.toFixed(4) ?? 'N/A';
  rows.push(`| ${id} | ${f('ts')} | ${f('fixed')} | ${f('staged')} | ${f('rust')} | ${f('moonbit')} | ${f('simd')} |`);
}
writeFileSync(resolve(directory, 'workload-table.md'), rows.join('\n') + '\n');
process.stdout.write(rows.join('\n') + '\n');
