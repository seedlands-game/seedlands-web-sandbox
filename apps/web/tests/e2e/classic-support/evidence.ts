import { expect, type TestInfo } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ChromeTrace, ClassicSnapshot } from './harness';
import type { ArtifactReadback, CompositionIdentity, PackLockReadback, RuntimeEnvironment } from './identity';
import type { ClassicScenario } from './scenario';

export type ClassicStage = `C${0 | 1 | 2 | 3 | 4 | 5}`;
export type ClassicStageResult = Readonly<{ status: 'PASS' | 'FAIL'; observation: string }>;

type EvidenceData = Readonly<{
  scenario: ClassicScenario;
  stages: Partial<Record<ClassicStage, ClassicStageResult>>;
  benchmarkMode: boolean;
  runId: string;
  artifact: ArtifactReadback;
  packLock: PackLockReadback;
  composition: CompositionIdentity | null;
  environment: RuntimeEnvironment;
  stageSamples: Partial<Record<ClassicStage, ClassicSnapshot>>;
  assets: readonly string[];
  workers: readonly string[];
  baseline: ClassicSnapshot;
  final: ClassicSnapshot;
  trace: ChromeTrace;
  pageErrors: readonly string[];
  failedResponses: readonly string[];
  restoreEvidence?: Readonly<Record<string, unknown>>;
  sampleStartedAt: string;
  sampleCompletedAt: string;
}>;

const kernelSummary = (snapshot: ClassicSnapshot) =>
  (snapshot.compute.workerActivity ?? []).reduce(
    (summary, activity) => ({
      calls: summary.calls + (activity.kernel?.calls ?? 0),
      failures: summary.failures + (activity.kernel?.failures ?? 0),
      memoryBytes: summary.memoryBytes + (activity.kernel?.memoryBytes ?? 0),
    }),
    { calls: 0, failures: 0, memoryBytes: 0 },
  );

const measurementSample = (stage: ClassicStage, snapshot: ClassicSnapshot) => ({
  stage,
  frame: snapshot.performance.frame,
  streaming: {
    chunkVisible: snapshot.performance.chunkVisible,
    completedChunkTraces: snapshot.performance.completedChunkTraces,
    traceEventCount: snapshot.performance.traceEventCount,
  },
  workers: {
    counts: snapshot.workers,
    submittedTasks: snapshot.compute.submittedTasks,
    completedTasks: snapshot.compute.completedTasks,
    failedTasks: snapshot.compute.failedTasks,
    staleResults: snapshot.compute.staleResults,
    submittedBytes: snapshot.compute.submittedBytes,
    kernel: kernelSummary(snapshot),
  },
  resources: {
    loadedChunks: snapshot.loadedChunks,
    renderedChunks: snapshot.renderedChunks,
    uploadQueueDepth: snapshot.performance.uploadQueueDepth,
    estimatedMeshBytes: snapshot.performance.estimatedMeshBytes,
    residency: snapshot.authority.residency,
    npcCount: snapshot.gameplay.npcCount,
    worldItemCount: snapshot.gameplay.worldItemCount,
    presentedEntityCount: snapshot.gameplay.presentedEntityCount,
  },
  storage: { bytes: snapshot.storageBytes },
});

const resultPath = () => (process.env.SEEDLANDS_CLASSIC_RESULT ? resolve(process.env.SEEDLANDS_CLASSIC_RESULT) : null);

function writeAttempt(evidence: Record<string, unknown>): void {
  const path = resultPath();
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  let attempts: unknown[] = [];
  try {
    const prior = JSON.parse(readFileSync(path, 'utf8')) as { attempts?: unknown[] };
    if (Array.isArray(prior.attempts)) attempts = prior.attempts;
  } catch {
    // A new run has no result file yet.
  }
  attempts.push(evidence);
  const status = attempts.every(
    (attempt) => attempt !== null && typeof attempt === 'object' && 'status' in attempt && attempt.status === 'PASS',
  )
    ? 'PASS'
    : 'FAIL';
  writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, status, attempts }, null, 2)}\n`);
}

export async function attachClassicEvidence(testInfo: TestInfo, data: EvidenceData): Promise<void> {
  const status =
    Object.values(data.stages).length === 6 &&
    Object.values(data.stages).every((stage) => stage.status === 'PASS') &&
    data.pageErrors.length === 0 &&
    data.failedResponses.length === 0
      ? 'PASS'
      : 'FAIL';
  const windowId = process.env.SEEDLANDS_PERFORMANCE_WINDOW_ID?.trim() || null;
  const evidencePath = process.env.SEEDLANDS_PERFORMANCE_WINDOW_EVIDENCE?.trim() || null;
  const declarationPath = process.env.SEEDLANDS_PERFORMANCE_MEASUREMENT_DECLARATION?.trim() || null;
  const reservedMeasurement =
    data.benchmarkMode &&
    process.env.SEEDLANDS_PERFORMANCE_WINDOW_RESERVED === '1' &&
    windowId !== null &&
    evidencePath !== null &&
    declarationPath !== null;
  const measurementStatus = !data.benchmarkMode ? 'NOT_MEASURED' : reservedMeasurement ? 'MEASURED' : 'DIAGNOSTIC';
  const stageOrder: readonly ClassicStage[] = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'];
  const samples = stageOrder.flatMap((stage) => {
    const value = data.stageSamples[stage];
    return value ? [measurementSample(stage, value)] : [];
  });
  const evidence = {
    schemaVersion: 1,
    status,
    attempt: testInfo.retry,
    test: testInfo.title,
    project: testInfo.project.name,
    scenario: {
      id: data.scenario.scenarioId,
      version: data.scenario.schemaVersion,
      seed: data.scenario.seed,
      generatorVersion: data.scenario.generatorVersion,
      playbookId: data.scenario.playbookId,
    },
    runId: data.runId,
    artifact: data.artifact,
    packLock: data.packLock,
    composition: data.composition,
    environment: data.environment,
    benchmark: {
      requested: data.benchmarkMode,
      mode: data.benchmarkMode ? 'runtime-benchmark' : 'correctness',
      evidenceClass: reservedMeasurement ? 'reserved-runtime-sample' : 'diagnostic-only',
      note: 'Playwright wall time, screenshots and unreserved runs are never performance acceptance.',
      measurement: {
        status: measurementStatus,
        runId: process.env.SEEDLANDS_HARNESS_RUN_ID ?? data.runId,
        owner: 'web-runtime',
        scenario: data.scenario.scenarioId,
        windowId,
        evidencePath,
        sampleStartedAt: data.sampleStartedAt,
        sampleCompletedAt: data.sampleCompletedAt,
        sourceSha: data.artifact.identity?.sourceSha,
        sourceDigest: data.artifact.identity?.sourceDigest,
        lockDigest: data.artifact.identity?.lockDigest,
        artifactDigest: data.artifact.identity?.artifactDigest,
        environment: data.environment,
        boundary: {
          preparation: 'Deterministic fixture setup completed before the C0 baseline.',
          measured: 'C0-C5 stage-boundary game telemetry and correlated in-game trace spans.',
          excludes: ['Playwright wall time', 'screenshots', 'fixture setup', 'unreserved performance claims'],
        },
        semantics: {
          stageSamples:
            'Each sample is the bounded rolling runtime telemetry visible at that stage boundary, not an isolated per-stage percentile window.',
          resources:
            'Resource values are boundary snapshots, not stage peaks unless the field name explicitly reports a maximum.',
        },
        latency: {
          inputToAuthorityMs: { status: 'UNAVAILABLE', reason: 'No correlated production telemetry field is exposed.' },
          inputToVisibleMs: { status: 'UNAVAILABLE', reason: 'No end-to-end input-to-present trace is exposed.' },
          saveMs: { status: 'UNAVAILABLE', reason: 'The canonical runtime does not expose save latency telemetry.' },
          loadMs: { status: 'UNAVAILABLE', reason: 'The canonical runtime does not expose load latency telemetry.' },
        },
        samples,
        rawTrace: data.trace.traceEvents,
      },
    },
    stages: data.stages,
    faultDesign: data.scenario.faultDesign,
    coverage: data.scenario.coverage,
    assets: data.assets,
    workers: data.workers,
    trace: data.trace,
    pageErrors: data.pageErrors,
    failedResponses: data.failedResponses,
    restoreEvidence: data.restoreEvidence,
    baseline: data.baseline,
    final: data.final,
  };
  await testInfo.attach('classic-runtime-evidence.json', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
  writeAttempt(evidence);
}

export async function attachClassicFailure(
  testInfo: TestInfo,
  stages: Partial<Record<ClassicStage, ClassicStageResult>>,
  current: ClassicSnapshot | null,
  benchmarkMode: boolean,
  restoreEvidence?: Readonly<Record<string, unknown>>,
): Promise<void> {
  const evidence = {
    schemaVersion: 1,
    status: 'FAIL',
    attempt: testInfo.retry,
    test: testInfo.title,
    project: testInfo.project.name,
    benchmark: benchmarkMode,
    stages,
    errors: testInfo.errors.map(({ message }) => message),
    current,
    restoreEvidence,
  };
  await testInfo.attach('classic-runtime-failure.json', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
  writeAttempt(evidence);
}

export function requireAllClassicStages(stages: Partial<Record<ClassicStage, ClassicStageResult>>): void {
  expect(Object.keys(stages).sort()).toEqual(['C0', 'C1', 'C2', 'C3', 'C4', 'C5']);
  expect(Object.values(stages).every(({ status }) => status === 'PASS')).toBe(true);
}
