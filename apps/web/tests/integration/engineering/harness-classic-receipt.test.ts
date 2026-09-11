import { expect, it } from 'vitest';
import { validateClassicReceipt } from '../../../../../scripts/harness/classic-receipt.mjs';

const artifact = {
  sourceSha: 'a'.repeat(40),
  sourceDigest: 'b'.repeat(64),
  lockDigest: 'c'.repeat(64),
  artifactDigest: 'd'.repeat(64),
  files: { 'assets/kernel.wasm': 'e'.repeat(64), 'packs/overworld.mjs': 'f'.repeat(64) },
};
const scenario = {
  schemaVersion: 1,
  scenarioId: 'classic-canonical-runtime-v1',
  seed: 'fixed-seed',
  generatorVersion: 4,
  playbookId: 'seedlands:overworld',
  playbookVersion: '1.0.0',
};
const expected = { runId: 'fixture-run', artifact, scenario, benchmark: false };
function receipt() {
  const attempt = {
    status: 'PASS',
    attempt: 0,
    runId: expected.runId,
    artifact: { ok: true, identity: artifact },
    scenario: {
      id: scenario.scenarioId,
      version: 1,
      seed: scenario.seed,
      generatorVersion: 4,
      playbookId: scenario.playbookId,
    },
    stages: Object.fromEntries(['C0', 'C1', 'C2', 'C3', 'C4', 'C5'].map((stage) => [stage, { status: 'PASS' }])),
    composition: { playbookId: scenario.playbookId, packLock: [{ id: scenario.playbookId, version: '1.0.0' }] },
    environment: { webgl2: { renderer: 'physical-test-gpu', version: 'WebGL 2.0' } },
    baseline: {
      runtime: 'authority-worker',
      renderPipeline: { backend: 'webgl2' },
      experiments: { requested: { wasm: true } },
    },
    final: {
      runtime: 'authority-worker',
      renderPipeline: { backend: 'webgl2' },
      experiments: {
        workers: [
          { lane: 'general', status: 'matched', effectiveArtifact: 'rust-simd', artifactSha256: 'e'.repeat(64) },
        ],
      },
    },
    assets: ['/assets/kernel.wasm', '/packs/overworld.mjs'],
    workers: ['/assets/authority-worker-abc.js', '/assets/world-worker-def.js'],
    benchmark: {
      requested: false,
      mode: 'correctness',
      measurement: {
        status: 'NOT_MEASURED',
        runId: expected.runId,
        owner: 'web-runtime',
        scenario: scenario.scenarioId,
        ...artifact,
        samples: ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'].map((stage, i) => ({
          stage,
          frame: { count: i + 1, p50Ms: 16, p95Ms: 20, p99Ms: 24, longFrameCount: 0 },
          workers: {
            submittedTasks: i + 1,
            completedTasks: i + 1,
            failedTasks: 0,
            kernel: { calls: i + 1, failures: 0 },
          },
        })),
      },
    },
    trace: {
      traceEvents: ['worker-start', 'worker-complete', 'commit-queued', 'visible-postrender'].map((name) => ({
        name,
        args: { traceId: 'new-route-task', traceName: 'chunk:1,1,0' },
      })),
    },
    pageErrors: [],
    failedResponses: [],
  };
  return { schemaVersion: 1, status: 'PASS', attempts: [attempt] };
}

it('accepts only a complete current Classic execution receipt', () => {
  expect(() => validateClassicReceipt(receipt(), expected)).not.toThrow();
});

it('rejects PASS alone and successful retries that hide an earlier failed attempt', () => {
  expect(() => validateClassicReceipt({ status: 'PASS' }, expected)).toThrow('Classic receipt');
  const value = receipt();
  value.attempts.push({ ...value.attempts[0]!, attempt: 1 });
  expect(() => validateClassicReceipt(value, expected)).toThrow('attempt');
});

it.each(['runId', 'sourceSha', 'sourceDigest', 'artifactDigest', 'scenario', 'stages'])('rejects wrong %s', (kind) => {
  const value = structuredClone(receipt());
  const attempt = value.attempts[0]!;
  if (kind === 'runId') attempt.runId = 'another-run';
  else if (kind === 'scenario') attempt.scenario.version = 2;
  else if (kind === 'stages') delete attempt.stages.C5;
  else attempt.artifact.identity[kind as 'sourceSha' | 'sourceDigest' | 'artifactDigest'] = '0'.repeat(64);
  expect(() => validateClassicReceipt(value, expected)).toThrow('Classic receipt');
});

it.each(['wasm-init-only', 'unconsumed-worker', 'wrong-backend', 'diagnostic-benchmark'])(
  'rejects insufficient execution evidence: %s',
  (kind) => {
    const value = receipt();
    const attempt = value.attempts[0]!;
    if (kind === 'wasm-init-only')
      for (const sample of attempt.benchmark.measurement.samples) sample.workers.kernel.calls = 0;
    if (kind === 'unconsumed-worker') attempt.trace.traceEvents.pop();
    if (kind === 'wrong-backend') attempt.final.renderPipeline.backend = 'webgpu';
    if (kind === 'diagnostic-benchmark') attempt.benchmark.measurement.status = 'DIAGNOSTIC';
    expect(() => validateClassicReceipt(value, expected)).toThrow('Classic receipt');
  },
);

it('binds runtime measurement to the exact current performance window', () => {
  const value = receipt();
  const attempt = value.attempts[0]!;
  attempt.benchmark.requested = true;
  attempt.benchmark.mode = 'runtime-benchmark';
  attempt.benchmark.measurement.status = 'MEASURED';
  Object.assign(attempt.benchmark.measurement, { windowId: 'old-window', evidencePath: '/fixture/old.json' });
  const runtime = {
    ...expected,
    benchmark: true,
    performanceWindow: { windowId: 'current-window', evidencePath: '/fixture/current.json' },
  };
  expect(() => validateClassicReceipt(value, runtime)).toThrow('performance window');
  Object.assign(attempt.benchmark.measurement, runtime.performanceWindow);
  expect(() => validateClassicReceipt(value, runtime)).not.toThrow();
});
