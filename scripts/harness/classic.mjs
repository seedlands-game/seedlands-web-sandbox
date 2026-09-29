import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyArtifact, root } from './artifact.mjs';
import { readClassicReceipt, validateClassicRunReceipt } from './classic-receipt.mjs';
import { performanceWindowContext, writeMeasurementDeclaration } from './performance-window-proof.mjs';

const artifact = verifyArtifact();
const runId = process.env.SEEDLANDS_HARNESS_RUN_ID ?? randomUUID();
const resultPath = resolve(root, 'harness/results', runId, 'classic.json');
const selectionArgs = process.argv.slice(2);
if (process.env.SEEDLANDS_CLASSIC_BENCHMARK === '1' && selectionArgs.length)
  throw new Error('Benchmark must use the complete frozen scenario; test selection is correctness-only.');
rmSync(resultPath, { force: true });
const result = spawnSync('pnpm', ['exec', 'playwright', 'test', '--config', 'playwright.config.ts', ...selectionArgs], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    SEEDLANDS_HARNESS_RUN_ID: runId,
    SEEDLANDS_SOURCE_SHA: artifact.sourceSha,
    SEEDLANDS_CLASSIC_RESULT: resultPath,
  },
});
if (result.error) throw result.error;
verifyArtifact();
const benchmark = process.env.SEEDLANDS_CLASSIC_BENCHMARK === '1';
const modularWorld = process.env.SEEDLANDS_PACK_SMOKE === 'modular-world';
const receipt = readClassicReceipt(resultPath);
const canonicalAttempt = validateClassicRunReceipt(receipt, {
  runId,
  sourceSha: artifact.sourceSha,
  processStatus: result.status,
  requireCanonicalMain: selectionArgs.length === 0 && !modularWorld,
  benchmark,
  modularWorld,
});
const window = performanceWindowContext();
if (benchmark) {
  if (!window || !canonicalAttempt) throw new Error('Classic benchmark requires a reserved canonical measurement.');
  const measurement = canonicalAttempt.benchmark.measurement;
  writeMeasurementDeclaration(window, {
    measurementPath: resultPath,
    format: 'classic',
    runId,
    owner: 'web-runtime',
    scenario: measurement.scenario,
  });
}
process.exitCode = result.status ?? 1;
