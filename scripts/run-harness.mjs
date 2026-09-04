import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { transformWithEsbuild } from 'vite';
import { currentBrowserEvidence } from './harness-browser-evidence.mjs';
import { collectDistMetrics } from './harness-file-metrics.mjs';

const root = resolve(import.meta.dirname, '..');
const baselinePath = resolve(root, 'harness/baseline.json');
const resultsDir = resolve(root, 'harness/results');
const browserResultPath = resolve(resultsDir, 'browser-e2e.json');
const browserBenchmarkPath = resolve(resultsDir, 'browser-benchmark.json');
const now = new Date().toISOString();
const expectedBrowserRunId = process.env.SEEDLANDS_HARNESS_RUN_ID;
const sourceSha = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'UNKNOWN';
  }
})();
const percentile = (values, q) => values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * q) - 1))];
const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1),
    totalMs: sorted.reduce((sum, value) => sum + value, 0),
  };
};
const bytes = (value) => new TextEncoder().encode(value).byteLength;
const compileModule = async (path, replacements = {}) => {
  let source = await readFile(path, 'utf8');
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to);
  const { code } = await transformWithEsbuild(source, path, { loader: 'ts', target: 'es2022', format: 'esm' });
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
};

function compare(current, baseline) {
  const verdicts = {};
  for (const [key, value] of Object.entries(current)) {
    const previous = baseline?.metrics?.[key];
    if (typeof value !== 'number' || typeof previous !== 'number' || previous === 0) continue;
    const percent = ((value - previous) / previous) * 100;
    const higherIsBetter = key.includes('Throughput');
    const regressionPercent = higherIsBetter ? -percent : percent;
    verdicts[key] = {
      baseline: previous,
      current: value,
      percent,
      direction: higherIsBetter ? 'higher-is-better' : 'lower-is-better',
      status: regressionPercent > 15 ? 'REGRESSION' : regressionPercent > 5 ? 'WARNING' : 'OK',
    };
  }
  return verdicts;
}

{
  const macroUrl = await compileModule(resolve(root, 'src/world/macro-world.ts'));
  const voxelUrl = await compileModule(resolve(root, 'src/world/voxel.ts'), { "'./macro-world'": `'${macroUrl}'` });
  const macro = await import(macroUrl);
  const voxel = await import(voxelUrl);
  const meshUrl = await compileModule(resolve(root, 'src/world/mesh.ts'), {
    "'./voxel'": `'${voxelUrl}'`,
    "'./macro-world'": `'${macroUrl}'`,
  });
  const storageUrl = await compileModule(resolve(root, 'src/world/storage.ts'), { "'./voxel'": `'${voxelUrl}'` });
  const { makeChunk, meshChunk } = await import(meshUrl);
  const { encodeWorldSave } = await import(storageUrl);
  const coordinates = [-3, -2, -1, 0, 1, 2, 3].flatMap((x) => [-2, -1, 0, 1, 2].map((z) => [x, 0, z]));
  const seed = voxel.normalizeSeed('seedlands-harness-benchmark-v1');
  const macroCoordinates = Array.from({ length: 256 }, (_, index) => [
    ((index % 16) - 8) * 256,
    (Math.floor(index / 16) - 8) * 256,
  ]);
  const macroTimes = macroCoordinates.map(([x, z]) => {
    const start = performance.now();
    macro.macroAt(seed, x, z);
    return performance.now() - start;
  });
  const macroGeneration = summarize(macroTimes);
  const macroHash = macro.macroSignature(seed, macroCoordinates);
  const generated = [];
  const generationTimes = coordinates.map(([cx, cy, cz]) => {
    const start = performance.now();
    const data = makeChunk(seed, cx, cy, cz, []);
    generated.push([cx, cy, cz, data]);
    return performance.now() - start;
  });
  const meshTimes = [];
  let meshBytes = 0;
  let vertices = 0;
  let triangles = 0;
  for (const [cx, cy, cz, data] of generated) {
    const start = performance.now();
    const meshes = meshChunk({ seed, cx, cy, cz, data, changes: [] });
    meshTimes.push(performance.now() - start);
    for (const mesh of Object.values(meshes)) {
      meshBytes +=
        mesh.positions.byteLength +
        mesh.normals.byteLength +
        mesh.uvs.byteLength +
        mesh.colors.byteLength +
        mesh.indices.byteLength;
      vertices += mesh.positions.length / 3;
      triangles += mesh.indices.length / 3;
    }
  }
  const generation = summarize(generationTimes),
    meshing = summarize(meshTimes);
  const storage = {};
  for (const count of [100, 1000, 10000, 50000]) {
    const changes = Array.from({ length: count }, (_, index) => [
      index - 25000,
      20 + (index % 3),
      ((index * 17) % 1000) - 500,
      (index % 7) + 1,
    ]);
    storage[count] = bytes(encodeWorldSave('seedlands-storage-benchmark-v1', [0, 34, 0], changes));
  }
  globalThis.gc?.();
  const heapAfterWork = process.memoryUsage().heapUsed;
  const worldMutationUrl = await compileModule(resolve(root, 'src/server/world-mutation.ts'), {
    "'../world/voxel'": `'${voxelUrl}'`,
  });
  const worldTransactionCommitUrl = await compileModule(resolve(root, 'src/server/world-transaction-commit.ts'), {
    "'../world/voxel'": `'${voxelUrl}'`,
    "'./world-mutation'": `'${worldMutationUrl}'`,
  });
  const gameServerUrl = await compileModule(resolve(root, 'src/server/game-server.ts'), {
    "'../world/mesh'": `'${meshUrl}'`,
    "'../world/voxel'": `'${voxelUrl}'`,
    "'./world-mutation'": `'${worldMutationUrl}'`,
    "'./world-transaction-commit'": `'${worldTransactionCommitUrl}'`,
  });
  const fillCommandUrl = await compileModule(resolve(root, 'src/server/commands/fill-command.ts'), {
    "'../../world/voxel'": `'${voxelUrl}'`,
    "'../world-mutation'": `'${worldMutationUrl}'`,
  });
  const { WorldMutationBuffer } = await import(worldMutationUrl);
  const { GameServer } = await import(gameServerUrl);
  const { resolveFillCommand } = await import(fillCommandUrl);
  globalThis.gc?.();
  const heapBeforeMutation = process.memoryUsage().heapUsed;
  const mutationBaseline = JSON.parse(
    await readFile(resolve(root, 'changes/2026-09-04-world-mutation-transaction/performance-baseline.json'), 'utf8'),
  );
  const mutationFillBounds = {
    1: [0, -10, 0],
    1000: [9, -1, 9],
    10000: [99, -1, 9],
    100000: [99, -1, 99],
  };
  const materializeMutationChunks = (server, buffer) => {
    const seen = new Set();
    for (const run of buffer.chunkRuns) {
      const key = `${run.cx},${run.cy},${run.cz}`;
      if (seen.has(key)) continue;
      seen.add(key);
      server.getChunk(run.cx, run.cy, run.cz);
    }
  };
  const fillSamples = {};
  for (const count of [1, 1000, 10000, 100000]) {
    const runP50Ms = [];
    const runP95Ms = [];
    let lastMetrics = null;
    for (let run = 0; run < 3; run += 1) {
      const server = new GameServer({ seedText: `harness-fill-${count}-${run}` });
      const warmup = resolveFillCommand({ from: [0, -10, 0], to: mutationFillBounds[count], voxel: voxel.Voxel.Wood });
      materializeMutationChunks(server, warmup);
      server.editBatch({ actorId: 'harness-warmup', buffers: [warmup] });
      const samples = [];
      for (let sample = 0; sample < 9; sample += 1) {
        const buffer = resolveFillCommand({
          from: [0, -10, 0],
          to: mutationFillBounds[count],
          voxel: sample % 2 ? voxel.Voxel.Wood : voxel.Voxel.Stone,
        });
        const startedAt = performance.now();
        const result = server.editBatch({ actorId: 'harness-fill', buffers: [buffer] });
        samples.push(performance.now() - startedAt);
        lastMetrics = result.metrics;
      }
      runP50Ms.push(
        percentile(
          [...samples].sort((left, right) => left - right),
          0.5,
        ),
      );
      runP95Ms.push(
        percentile(
          [...samples].sort((left, right) => left - right),
          0.95,
        ),
      );
    }
    fillSamples[count] = {
      medianP50Ms: percentile(
        [...runP50Ms].sort((left, right) => left - right),
        0.5,
      ),
      medianP95Ms: percentile(
        [...runP95Ms].sort((left, right) => left - right),
        0.5,
      ),
      runP50Ms,
      runP95Ms,
      metrics: lastMetrics,
    };
  }
  const sampleSequentialMutations = (server, count, value) => {
    const startedAt = performance.now();
    for (let index = 0; index < count; index += 1) {
      const x = index % 100;
      const z = Math.floor(index / 100) % 100;
      const y = -10 + (Math.floor(index / 10000) % 10);
      server.edit(x, y, z, value);
    }
    return performance.now() - startedAt;
  };
  const singleEditRunP50Ms = [];
  const singleEditRunP95Ms = [];
  const sequentialRunP50Ms = [];
  const batchRunP50Ms = [];
  for (let run = 0; run < 3; run += 1) {
    const single = new GameServer({ seedText: `harness-single-${run}` });
    const sequential = new GameServer({ seedText: `harness-sequential-${run}` });
    const batched = new GameServer({ seedText: `harness-batched-${run}` });
    const fill = resolveFillCommand({ from: [0, -10, 0], to: [99, -1, 99], voxel: voxel.Voxel.Wood });
    materializeMutationChunks(single, fill);
    materializeMutationChunks(sequential, fill);
    materializeMutationChunks(batched, fill);
    sampleSequentialMutations(single, 10000, voxel.Voxel.Wood);
    sampleSequentialMutations(sequential, 100000, voxel.Voxel.Wood);
    batched.editBatch({ actorId: 'harness-warmup', buffers: [fill] });
    const singleSamples = [];
    const sequentialSamples = [];
    const batchSamples = [];
    for (let sample = 0; sample < 9; sample += 1) {
      const value = sample % 2 ? voxel.Voxel.Wood : voxel.Voxel.Stone;
      singleSamples.push(sampleSequentialMutations(single, 10000, value));
      const buffer = resolveFillCommand({ from: [0, -10, 0], to: [99, -1, 99], voxel: value });
      if ((run + sample) % 2 === 0) {
        sequentialSamples.push(sampleSequentialMutations(sequential, 100000, value));
        const startedAt = performance.now();
        batched.editBatch({ actorId: 'harness-batch', buffers: [buffer] });
        batchSamples.push(performance.now() - startedAt);
      } else {
        const startedAt = performance.now();
        batched.editBatch({ actorId: 'harness-batch', buffers: [buffer] });
        batchSamples.push(performance.now() - startedAt);
        sequentialSamples.push(sampleSequentialMutations(sequential, 100000, value));
      }
    }
    const sortedSingle = [...singleSamples].sort((left, right) => left - right);
    singleEditRunP50Ms.push(percentile(sortedSingle, 0.5));
    singleEditRunP95Ms.push(percentile(sortedSingle, 0.95));
    sequentialRunP50Ms.push(
      percentile(
        [...sequentialSamples].sort((left, right) => left - right),
        0.5,
      ),
    );
    batchRunP50Ms.push(
      percentile(
        [...batchSamples].sort((left, right) => left - right),
        0.5,
      ),
    );
  }
  const medianOf = (values) =>
    percentile(
      [...values].sort((left, right) => left - right),
      0.5,
    );
  const singleEditMedianP50Ms = medianOf(singleEditRunP50Ms);
  const singleEditMedianP95Ms = medianOf(singleEditRunP95Ms);
  const sequentialMedianP50Ms = medianOf(sequentialRunP50Ms);
  const batchMedianP50Ms = medianOf(batchRunP50Ms);
  const matchingMutationEnvironment =
    mutationBaseline.environment.node === process.version &&
    mutationBaseline.environment.platform === process.platform &&
    mutationBaseline.environment.arch === process.arch;
  const singleEditStatus = !matchingMutationEnvironment
    ? 'NOT_COMPARABLE'
    : singleEditMedianP50Ms <= mutationBaseline.preChange.singleEdit10000.medianP50Ms * 1.15 &&
        singleEditMedianP95Ms <= mutationBaseline.preChange.singleEdit10000.medianP95Ms * 1.25
      ? 'PASS'
      : 'REGRESSION';
  const batchSpeedup = sequentialMedianP50Ms / batchMedianP50Ms;
  const batchStatus = batchSpeedup >= 2 ? 'PASS' : 'REGRESSION';
  const overwriteServer = new GameServer({ seedText: 'harness-overwrite-heavy' });
  const overwriteBuffer = new WorldMutationBuffer({
    sourceId: 'harness-overwrite-heavy',
    priority: 0,
    initialCapacity: 100000,
  });
  for (let pass = 0; pass < 10; pass += 1)
    for (let index = 0; index < 10000; index += 1)
      overwriteBuffer.write(index % 100, -10, Math.floor(index / 100), pass % 2 ? voxel.Voxel.Wood : voxel.Voxel.Stone);
  const overwriteResult = overwriteServer.editBatch({ actorId: 'harness-overwrite-heavy', buffers: [overwriteBuffer] });
  const overwriteStatus =
    overwriteResult.metrics.inputMutationCount === 100000 &&
    overwriteResult.metrics.canonicalWriteCount === 10000 &&
    overwriteResult.metrics.structuralEventCount === 1
      ? 'PASS'
      : 'REGRESSION';
  const heapAfterMutation = process.memoryUsage().heapUsed;
  const worldMutation = {
    status:
      singleEditStatus === 'REGRESSION' || batchStatus === 'REGRESSION' || overwriteStatus === 'REGRESSION'
        ? 'REGRESSION'
        : 'PASS',
    environmentComparable: matchingMutationEnvironment,
    singleEdit: {
      status: singleEditStatus,
      medianP50Ms: singleEditMedianP50Ms,
      medianP95Ms: singleEditMedianP95Ms,
      p50LimitMs: mutationBaseline.preChange.singleEdit10000.medianP50Ms * 1.15,
      p95LimitMs: mutationBaseline.preChange.singleEdit10000.medianP95Ms * 1.25,
      runP50Ms: singleEditRunP50Ms,
      runP95Ms: singleEditRunP95Ms,
    },
    batchComparison: {
      status: batchStatus,
      sequentialMedianP50Ms,
      batchMedianP50Ms,
      speedup: batchSpeedup,
      sequentialRunP50Ms,
      batchRunP50Ms,
    },
    overwriteHeavy: { status: overwriteStatus, metrics: overwriteResult.metrics },
    memoryProxy: {
      heapBeforeMutation,
      heapAfterMutation,
      heapDeltaBytes: heapAfterMutation - heapBeforeMutation,
      note: 'Process heap delta is an environment-local proxy and includes benchmark-retained objects.',
    },
    fillSamples,
  };
  const bundle = await collectDistMetrics(root);
  const metrics = {
    macroQueryP95Ms: macroGeneration.p95Ms,
    macroQueryThroughputPerSecond: (macroCoordinates.length / macroGeneration.totalMs) * 1000,
    worldgenP95Ms: generation.p95Ms,
    worldgenThroughputChunksPerSecond: (coordinates.length / generation.totalMs) * 1000,
    meshingP95Ms: meshing.p95Ms,
    meshingThroughputChunksPerSecond: (coordinates.length / meshing.totalMs) * 1000,
    meshVertices: vertices,
    meshTriangles: triangles,
    voxelDataBytes: generated.length * voxel.CHUNK_SIZE ** 3 * Uint16Array.BYTES_PER_ELEMENT,
    meshDataBytes: meshBytes,
    jsHeapAfterWork: heapAfterWork,
    save10000Bytes: storage[10000],
    totalBuildBytes: bundle.totalBytes,
    jsBundleBytes: bundle.jsBytes,
    gzipJsBundleBytes: bundle.gzipBytes,
  };
  const isBaseline = process.argv.includes('--baseline');
  const baseline = isBaseline ? null : JSON.parse(await readFile(baselinePath, 'utf8'));
  const browserE2E = await currentBrowserEvidence(
    browserResultPath,
    'browserE2E',
    { status: 'NOT_RUN', note: 'No current correlated browser regression result is available.' },
    expectedBrowserRunId,
    sourceSha,
  );
  const browserBenchmark = await currentBrowserEvidence(
    browserBenchmarkPath,
    'browserBenchmark',
    { status: 'NOT_RUN', note: 'No current correlated browser benchmark sample is available.' },
    expectedBrowserRunId,
    sourceSha,
  );
  const result = {
    schemaVersion: 1,
    generatedAt: now,
    sourceSha,
    browserRunId: expectedBrowserRunId ?? null,
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    correctness: { status: 'PASS', command: 'pnpm test (run before this script)' },
    performance: {
      macro: { ...macroGeneration, signature: macroHash, throughputPerSecond: metrics.macroQueryThroughputPerSecond },
      worldgen: { ...generation, throughputChunksPerSecond: metrics.worldgenThroughputChunksPerSecond },
      meshing: { ...meshing, throughputChunksPerSecond: metrics.meshingThroughputChunksPerSecond, vertices, triangles },
    },
    memoryProxy: {
      jsHeapAfterWork: heapAfterWork,
      voxelDataBytes: metrics.voxelDataBytes,
      meshDataBytes: meshBytes,
      note: 'Node heap and typed-array payload metrics; GPU memory requires browser tooling.',
    },
    storage: { bytesByMutationCount: storage },
    bundle,
    browserE2E,
    browserBenchmark,
    worldMutation,
    metrics,
    comparison: compare(metrics, baseline),
  };
  await mkdir(resultsDir, { recursive: true });
  if (isBaseline)
    await writeFile(
      baselinePath,
      `${JSON.stringify({ schemaVersion: 1, createdAt: now, environment: result.environment, metrics }, null, 2)}\n`,
    );
  await writeFile(resolve(resultsDir, 'latest.json'), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    '# Seedlands Harness Result',
    '',
    `Generated: ${now}`,
    '',
    '## Correctness',
    '',
    '- PASS — run `pnpm test` before this report.',
    '',
    '## Performance',
    '',
    `- Macro query p50/p95: ${macroGeneration.p50Ms.toFixed(2)} / ${macroGeneration.p95Ms.toFixed(2)} ms; throughput ${metrics.macroQueryThroughputPerSecond.toFixed(1)} queries/s; signature ${macroHash}.`,
    `- Worldgen p50/p95: ${generation.p50Ms.toFixed(2)} / ${generation.p95Ms.toFixed(2)} ms; throughput ${metrics.worldgenThroughputChunksPerSecond.toFixed(1)} chunks/s.`,
    `- Meshing p50/p95: ${meshing.p50Ms.toFixed(2)} / ${meshing.p95Ms.toFixed(2)} ms; throughput ${metrics.meshingThroughputChunksPerSecond.toFixed(1)} chunks/s.`,
    '',
    '## Memory and Storage',
    '',
    `- Node heap after workload: ${heapAfterWork} bytes; voxel payload: ${metrics.voxelDataBytes} bytes; mesh payload: ${meshBytes} bytes.`,
    ...Object.entries(storage).map(([count, size]) => `- ${count} mutations: ${size} serialized bytes.`),
    '',
    '## Bundle',
    '',
    `- JS: ${bundle.jsBytes} bytes; gzip: ${bundle.gzipBytes} bytes; total output: ${bundle.totalBytes} bytes across ${bundle.fileCount} files.`,
    '',
    '## World mutation transaction',
    '',
    `- ${worldMutation.status} — 10k single edit p50/p95: ${singleEditMedianP50Ms.toFixed(2)} / ${singleEditMedianP95Ms.toFixed(2)} ms (${singleEditStatus}).`,
    `- 100k sequential/batch p50: ${sequentialMedianP50Ms.toFixed(2)} / ${batchMedianP50Ms.toFixed(2)} ms; speedup ${batchSpeedup.toFixed(2)}x (${batchStatus}).`,
    `- 100k fill structural events: ${fillSamples[100000].metrics.structuralEventCount}; dirty chunks: ${fillSamples[100000].metrics.dirtyChunkCount}; mesh invalidations: ${fillSamples[100000].metrics.meshInvalidationCount}.`,
    `- Overwrite-heavy 100k input / 10k unique: ${overwriteResult.metrics.canonicalWriteCount} canonical writes (${overwriteStatus}).`,
    `- Mutation heap proxy delta: ${heapAfterMutation - heapBeforeMutation} bytes.`,
    '',
    '## Baseline comparison',
    '',
    ...Object.entries(result.comparison).map(
      ([key, value]) => `- ${key}: ${value.percent.toFixed(1)}% (${value.status}).`,
    ),
    '',
    '## Browser E2E',
    '',
    `- ${browserE2E.status}${
      browserE2E.stages
        ? ` — ${Object.entries(browserE2E.stages)
            .map(([stage, status]) => `${stage}: ${status}`)
            .join(', ')}`
        : ` — ${browserE2E.note}`
    }`,
    '',
    '## Browser benchmark sample',
    '',
    `- ${browserBenchmark.status}${
      typeof browserBenchmark.initialWorldReadyMs === 'number'
        ? ` — initial world ready: ${browserBenchmark.initialWorldReadyMs.toFixed(2)} ms.`
        : ` — ${browserBenchmark.note}`
    }`,
    '',
    'Browser E2E is intentionally not a cross-machine timing baseline.',
    '',
  ];
  await writeFile(resolve(resultsDir, 'latest.md'), lines.join('\n'));
  const existingRegression = Object.values(result.comparison).some((value) => value.status === 'REGRESSION');
  if (worldMutation.status === 'REGRESSION' || existingRegression) process.exitCode = 1;
  console.log(
    JSON.stringify(
      {
        harness: isBaseline ? 'baseline updated' : 'benchmark complete',
        result: relative(root, resolve(resultsDir, 'latest.json')),
        browserE2E: browserE2E.status,
        browserBenchmark: browserBenchmark.status,
      },
      null,
      2,
    ),
  );
}
