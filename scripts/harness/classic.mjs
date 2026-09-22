import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyArtifact, root } from './artifact.mjs';
import { performanceWindowContext, writeMeasurementDeclaration } from './performance-window-proof.mjs';

const artifact = verifyArtifact();
const runId = process.env.SEEDLANDS_HARNESS_RUN_ID ?? randomUUID();
const resultPath = resolve(root, 'harness/results', runId, 'classic.json');
const result = spawnSync('pnpm', ['exec', 'playwright', 'test', '--config', 'playwright.config.ts'], {
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
const window = performanceWindowContext();
if (result.status === 0 && process.env.SEEDLANDS_CLASSIC_BENCHMARK === '1' && window) {
  const receipt = JSON.parse(readFileSync(resultPath, 'utf8'));
  if (receipt?.status !== 'PASS' || receipt.attempts?.length !== 1)
    throw new Error('Classic benchmark declaration requires exactly one PASS attempt.');
  const measurement = receipt.attempts[0]?.benchmark?.measurement;
  if (measurement?.status !== 'MEASURED') throw new Error('Classic benchmark did not produce a measured record.');
  writeMeasurementDeclaration(window, {
    measurementPath: resultPath,
    format: 'classic',
    runId,
    owner: 'web-runtime',
    scenario: measurement.scenario,
  });
}
process.exitCode = result.status ?? 1;
