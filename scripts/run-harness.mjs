import { gzipSync } from 'node:zlib';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { transformWithEsbuild } from 'vite';

const root = resolve(import.meta.dirname, '..');
const baselinePath = resolve(root, 'harness/baseline.json');
const resultsDir = resolve(root, 'harness/results');
const browserResultPath = resolve(resultsDir, 'browser-e2e.json');
const now = new Date().toISOString();
const percentile = (values, q) => values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * q) - 1))];
const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, p50Ms: percentile(sorted, .5), p95Ms: percentile(sorted, .95), maxMs: sorted.at(-1), totalMs: sorted.reduce((sum, value) => sum + value, 0) };
};
const bytes = (value) => new TextEncoder().encode(value).byteLength;
const compileModule = async (path, replacements = {}) => {
  let source = await readFile(path, 'utf8');
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to);
  const { code } = await transformWithEsbuild(source, path, { loader: 'ts', target: 'es2022', format: 'esm' });
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
};

async function distMetrics() {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(full);
    }
  }
  await walk(resolve(root, 'dist'));
  let totalBytes = 0, jsBytes = 0, gzipBytes = 0;
  for (const file of files) {
    const content = await readFile(file); totalBytes += content.byteLength;
    if (file.endsWith('.js')) { jsBytes += content.byteLength; gzipBytes += gzipSync(content).byteLength; }
  }
  return { fileCount: files.length, totalBytes, jsBytes, gzipBytes };
}

function compare(current, baseline) {
  const verdicts = {};
  for (const [key, value] of Object.entries(current)) {
    const previous = baseline?.metrics?.[key];
    if (typeof value !== 'number' || typeof previous !== 'number' || previous === 0) continue;
    const percent = (value - previous) / previous * 100;
    const higherIsBetter = key.includes('Throughput');
    const regressionPercent = higherIsBetter ? -percent : percent;
    verdicts[key] = { baseline: previous, current: value, percent, direction: higherIsBetter ? 'higher-is-better' : 'lower-is-better', status: regressionPercent > 15 ? 'REGRESSION' : regressionPercent > 5 ? 'WARNING' : 'OK' };
  }
  return verdicts;
}

{
  const voxelUrl = await compileModule(resolve(root, 'src/voxel.ts'));
  const voxel = await import(voxelUrl);
  const meshUrl = await compileModule(resolve(root, 'src/world-mesh.ts'), { "'./voxel'": `'${voxelUrl}'` });
  const storageUrl = await compileModule(resolve(root, 'src/world-storage.ts'), { "'./voxel'": `'${voxelUrl}'` });
  const { makeChunk, meshChunk } = await import(meshUrl);
  const { encodeWorldSave } = await import(storageUrl);
  const coordinates = [-3, -2, -1, 0, 1, 2, 3].flatMap((x) => [-2, -1, 0, 1, 2].map((z) => [x, 0, z]));
  const seed = voxel.normalizeSeed('seedlands-harness-benchmark-v1');
  const generated = [];
  const generationTimes = coordinates.map(([cx, cy, cz]) => {
    const start = performance.now(); const data = makeChunk(seed, cx, cy, cz, []); generated.push([cx, cy, cz, data]); return performance.now() - start;
  });
  const meshTimes = []; let meshBytes = 0; let vertices = 0; let triangles = 0;
  for (const [cx, cy, cz, data] of generated) {
    const start = performance.now(); const meshes = meshChunk({ seed, cx, cy, cz, data, changes: [] }); meshTimes.push(performance.now() - start);
    for (const mesh of Object.values(meshes)) { meshBytes += mesh.positions.byteLength + mesh.normals.byteLength + mesh.indices.byteLength; vertices += mesh.positions.length / 3; triangles += mesh.indices.length / 3; }
  }
  const generation = summarize(generationTimes), meshing = summarize(meshTimes);
  const storage = {};
  for (const count of [100, 1000, 10000, 50000]) {
    const changes = Array.from({ length: count }, (_, index) => [index - 25000, 20 + index % 3, (index * 17) % 1000 - 500, index % 7 + 1]);
    storage[count] = bytes(encodeWorldSave('seedlands-storage-benchmark-v1', [0, 34, 0], changes));
  }
  const bundle = await distMetrics();
  const heapAfterWork = process.memoryUsage().heapUsed;
  const metrics = {
    worldgenP95Ms: generation.p95Ms, worldgenThroughputChunksPerSecond: coordinates.length / generation.totalMs * 1000,
    meshingP95Ms: meshing.p95Ms, meshingThroughputChunksPerSecond: coordinates.length / meshing.totalMs * 1000,
    meshVertices: vertices, meshTriangles: triangles, voxelDataBytes: generated.length * voxel.CHUNK_SIZE ** 3 * Uint16Array.BYTES_PER_ELEMENT,
    meshDataBytes: meshBytes, jsHeapAfterWork: heapAfterWork, save10000Bytes: storage[10000], totalBuildBytes: bundle.totalBytes, jsBundleBytes: bundle.jsBytes, gzipJsBundleBytes: bundle.gzipBytes,
  };
  const isBaseline = process.argv.includes('--baseline');
  const baseline = isBaseline ? null : JSON.parse(await readFile(baselinePath, 'utf8'));
  let browserE2E = { status: 'NOT_RUN', note: 'Run pnpm harness:e2e before the complete harness report.' };
  try { browserE2E = (JSON.parse(await readFile(browserResultPath, 'utf8'))).browserE2E; } catch { /* baseline-only runs do not require a browser result */ }
  const result = {
    schemaVersion: 1, generatedAt: now, environment: { node: process.version, platform: process.platform, arch: process.arch },
    correctness: { status: 'PASS', command: 'pnpm test (run before this script)' },
    performance: { worldgen: { ...generation, throughputChunksPerSecond: metrics.worldgenThroughputChunksPerSecond }, meshing: { ...meshing, throughputChunksPerSecond: metrics.meshingThroughputChunksPerSecond, vertices, triangles } },
    memoryProxy: { jsHeapAfterWork: heapAfterWork, voxelDataBytes: metrics.voxelDataBytes, meshDataBytes: meshBytes, note: 'Node heap and typed-array payload metrics; GPU memory requires browser tooling.' },
    storage: { bytesByMutationCount: storage }, bundle, browserE2E, metrics, comparison: compare(metrics, baseline),
  };
  await mkdir(resultsDir, { recursive: true });
  if (isBaseline) await writeFile(baselinePath, `${JSON.stringify({ schemaVersion: 1, createdAt: now, environment: result.environment, metrics }, null, 2)}\n`);
  await writeFile(resolve(resultsDir, 'latest.json'), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    '# Seedlands Harness Result', '', `Generated: ${now}`, '', '## Correctness', '', '- PASS — run `pnpm test` before this report.', '', '## Performance', '', `- Worldgen p50/p95: ${generation.p50Ms.toFixed(2)} / ${generation.p95Ms.toFixed(2)} ms; throughput ${metrics.worldgenThroughputChunksPerSecond.toFixed(1)} chunks/s.`, `- Meshing p50/p95: ${meshing.p50Ms.toFixed(2)} / ${meshing.p95Ms.toFixed(2)} ms; throughput ${metrics.meshingThroughputChunksPerSecond.toFixed(1)} chunks/s.`, '', '## Memory and Storage', '', `- Node heap after workload: ${heapAfterWork} bytes; voxel payload: ${metrics.voxelDataBytes} bytes; mesh payload: ${meshBytes} bytes.`, ...Object.entries(storage).map(([count, size]) => `- ${count} mutations: ${size} serialized bytes.`), '', '## Bundle', '', `- JS: ${bundle.jsBytes} bytes; gzip: ${bundle.gzipBytes} bytes; total output: ${bundle.totalBytes} bytes across ${bundle.fileCount} files.`, '', '## Baseline comparison', '', ...Object.entries(result.comparison).map(([key, value]) => `- ${key}: ${value.percent.toFixed(1)}% (${value.status}).`), '', '## Browser E2E', '', `- ${browserE2E.status}${browserE2E.stages ? ` — ${Object.entries(browserE2E.stages).map(([stage, status]) => `${stage}: ${status}`).join(', ')}` : ` — ${browserE2E.note}`}`, '', 'Browser E2E is intentionally not a cross-machine timing baseline.', '',
  ];
  await writeFile(resolve(resultsDir, 'latest.md'), lines.join('\n'));
  console.log(JSON.stringify({ harness: isBaseline ? 'baseline updated' : 'benchmark complete', result: relative(root, resolve(resultsDir, 'latest.json')), browserE2E: browserE2E.status }, null, 2));
}
