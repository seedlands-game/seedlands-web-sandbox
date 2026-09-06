import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { createServer } from 'vite';
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false },
  logLevel: 'error',
});
let pairedBootstrap;
try {
  ({ pairedBootstrap } = await server.ssrLoadModule(
    resolve(import.meta.dirname, '../changes/2026-09-06-moonbit-wasm-workload-experiment/e2e/ab-statistics.ts'),
  ));
} finally {
  await server.close();
}
const directory = resolve(import.meta.dirname, '../changes/2026-09-06-data-plane-simd-policy/evidence');
const names = [
  'occupancy-32768',
  'uv-32768',
  'uv-262144',
  'colors-262144',
  'indices-262144',
  'mesh-natural',
  'mesh-stress',
];
const records = readdirSync(directory)
  .filter((p) => /^simd-.*\.json$/.test(p) && !p.includes('build-manifest'))
  .map((p) => ({ file: p, data: JSON.parse(readFileSync(resolve(directory, p), 'utf8')) }))
  .filter((r) => r.data.evidenceClass === 'formal');
const latest = records
  .map((r) => r.data.runId)
  .sort()
  .at(-1);
const results = [];
for (const name of names) {
  const record = records.find((r) => r.data.name === name && r.data.runId === latest);
  if (!record || record.data.status !== 'completed') throw new Error(`正式采样未完成: ${name}`);
  const d = record.data;
  if (d.pairs < 10 || d.events < 1000 || d.warmupMs < 5000 || !d.headless) throw new Error('非正式测量参数');
  if (d.prepared.legacyFailures.some((f) => !f.includes('RangeError: Maximum call stack size exceeded')))
    throw new Error('旧 TS 有非预期失败，不能交付');
  const raw = JSON.parse(gunzipSync(readFileSync(resolve(directory, `${record.file}.raw.gz`))).toString());
  const means = (mode, key) =>
    raw.runs.filter((r) => r.mode === mode).map((r) => r.samples.reduce((n, s) => n + s[key], 0) / r.samples.length);
  const meanCompute = pairedBootstrap(means('scalar', 'computeMs'), means('simd', 'computeMs'));
  const c = d.comparisons;
  const reasons = [];
  if (c.scalarVsSimd.status) reasons.push('p50 低于时钟分辨率');
  else if (c.scalarVsSimd.improvement < 15 || c.scalarVsSimd.ci95[0] <= 0) reasons.push('p50/置信区间未过门槛');
  for (const key of ['p95', 'p99'])
    if (c[key].candidate - c[key].baseline > Math.max(0.05, c[key].baseline * 0.05)) reasons.push(`${key} 退化超限`);
  if (c.scalarVsSimd.baseline - c.scalarVsSimd.candidate < 0.2 - 1e-6)
    reasons.push('未达 0.2 ms/任务，实际频率预算另需生产证据');
  results.push({
    name,
    file: record.file,
    core: c.core ?? null,
    p50: c.scalarVsSimd,
    p95: c.p95,
    p99: c.p99,
    meanEndToEnd: c.meanEndToEnd,
    meanCompute,
    latencyDerivedTasksPerSecond: { scalar: 1000 / c.meanEndToEnd.baseline, simd: 1000 / c.meanEndToEnd.candidate },
    reasons,
    legacyFailures: d.prepared.legacyFailures,
    prepared: d.prepared,
  });
}
writeFileSync(
  resolve(directory, 'simd-summary.json'),
  JSON.stringify({ runId: latest, scope: '独立 Worker 数值任务；非游戏帧率/整版本 A/B', results }, null, 2) + '\n',
);
const f = (n) => n.toFixed(4);
const rows = results.map(
  (r) =>
    `| ${r.name} | ${r.core ? `${f(r.core.baseline)} → ${f(r.core.candidate)} (${r.core.improvement.toFixed(1)}%)` : 'N/A，完整打包阶段见下表'} | ${r.p50.status ? '不可判定（时钟分辨率）' : `${f(r.p50.baseline)} → ${f(r.p50.candidate)}`} | ${f(r.meanEndToEnd.baseline)} → ${f(r.meanEndToEnd.candidate)} (${r.meanEndToEnd.improvement.toFixed(1)}%) | ${r.reasons.join('；') || '数值门槛通过，须复核生产消费场景'} |`,
);
const tails = results.map(
  (r) =>
    `| ${r.name} | ${f(r.meanCompute.baseline)} → ${f(r.meanCompute.candidate)} (${r.meanCompute.improvement.toFixed(1)}%) | ${f(r.p95.baseline)} → ${f(r.p95.candidate)} | ${f(r.p99.baseline)} → ${f(r.p99.candidate)} |`,
);
writeFileSync(
  resolve(directory, 'simd-tables.md'),
  `| 场景 | 热内核 ms（耗时下降） | 独立任务 p50 ms | 独立任务平均 ms（耗时下降） | 预注册门槛 |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n| 场景 | Worker 内完整计算阶段平均 ms（耗时下降） | 独立任务 p95 ms | 独立任务 p99 ms |\n| --- | --- | --- | --- |\n${tails.join('\n')}\n`,
);
process.stdout.write(
  JSON.stringify(
    results.map((r) => ({ name: r.name, reasons: r.reasons })),
    null,
    2,
  ) + '\n',
);
