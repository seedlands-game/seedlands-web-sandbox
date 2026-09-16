const fail = (message) => {
  throw new Error(`Invalid Classic receipt: ${message}`);
};
const stages = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'];
const identityKeys = ['sourceSha', 'sourceDigest', 'lockDigest', 'artifactDigest'];

export function validateClassicReceipt(receipt, expected) {
  if (receipt?.schemaVersion !== 1 || receipt.status !== 'PASS') fail('missing complete PASS envelope');
  if (!Array.isArray(receipt.attempts) || receipt.attempts.length !== 1)
    fail('exactly one successful attempt required');
  const attempt = receipt.attempts[0];
  if (attempt?.status !== 'PASS' || attempt.attempt !== 0) fail('failed or retried attempt');
  if (attempt.runId !== expected.runId) fail('runId does not match this invocation');
  if (!attempt.artifact?.ok) fail('browser artifact readback unavailable');
  for (const key of identityKeys) {
    if (attempt.artifact.identity?.[key] !== expected.artifact[key]) fail(`artifact ${key} mismatch`);
  }
  if (JSON.stringify(attempt.artifact.identity.files) !== JSON.stringify(expected.artifact.files))
    fail('browser artifact file identities differ');
  const scenario = attempt.scenario;
  if (
    scenario?.id !== expected.scenario.scenarioId ||
    scenario.version !== expected.scenario.schemaVersion ||
    scenario.seed !== expected.scenario.seed ||
    scenario.generatorVersion !== expected.scenario.generatorVersion ||
    scenario.playbookId !== expected.scenario.playbookId
  )
    fail('scenario identity or version mismatch');
  if (
    Object.keys(attempt.stages ?? {})
      .sort()
      .join(',') !== stages.join(',') ||
    stages.some((stage) => attempt.stages[stage]?.status !== 'PASS')
  )
    fail('incomplete C0-C5 stages');
  if (
    attempt.composition?.playbookId !== expected.scenario.playbookId ||
    !attempt.composition.packLock?.some(
      ({ id, version }) => id === expected.scenario.playbookId && version === expected.scenario.playbookVersion,
    )
  )
    fail('admitted composition mismatch');
  if (
    !Array.isArray(attempt.pageErrors) ||
    attempt.pageErrors.length ||
    !Array.isArray(attempt.failedResponses) ||
    attempt.failedResponses.length
  )
    fail('missing or failed browser error ledger');
  for (const snapshot of [attempt.baseline, attempt.final]) {
    if (snapshot?.runtime !== 'authority-worker' || snapshot.renderPipeline?.backend !== 'webgl2')
      fail('effective authority or backend mismatch');
  }
  if (!attempt.environment?.webgl2?.renderer || !attempt.environment.webgl2.version)
    fail('actual WebGL2 context unavailable');
  const hashes = new Set(Object.values(expected.artifact.files));
  if (
    attempt.baseline.experiments?.requested?.wasm !== true ||
    !attempt.final.experiments?.workers?.some(
      (worker) =>
        worker.lane === 'general' &&
        worker.status === 'matched' &&
        worker.effectiveArtifact !== 'typescript' &&
        hashes.has(worker.artifactSha256),
    )
  )
    fail('matched executed Wasm artifact unavailable');
  if (
    !attempt.assets?.some((path) => path.endsWith('.wasm')) ||
    !attempt.workers?.some((path) => /authority-worker-[\w-]+\.js$/.test(path)) ||
    !attempt.workers?.some((path) => /world-worker-[\w-]+\.js$/.test(path))
  )
    fail('actual Worker/Wasm resource ledger missing');
  const benchmark = attempt.benchmark;
  const measurement = benchmark?.measurement;
  if (
    benchmark?.requested !== expected.benchmark ||
    benchmark.mode !== (expected.benchmark ? 'runtime-benchmark' : 'correctness') ||
    measurement?.status !== (expected.benchmark ? 'MEASURED' : 'NOT_MEASURED') ||
    measurement.runId !== expected.runId ||
    measurement.owner !== 'web-runtime' ||
    measurement.scenario !== expected.scenario.scenarioId
  )
    fail('benchmark class or measurement identity mismatch');
  for (const key of identityKeys) if (measurement[key] !== expected.artifact[key]) fail(`measurement ${key} mismatch`);
  if (
    expected.benchmark &&
    (!expected.performanceWindow ||
      measurement.windowId !== expected.performanceWindow.windowId ||
      measurement.evidencePath !== expected.performanceWindow.evidencePath)
  )
    fail('performance window does not match this invocation');
  if (
    !Array.isArray(measurement.samples) ||
    measurement.samples.map(({ stage }) => stage).join(',') !== stages.join(',')
  )
    fail('missing stage execution samples');
  const initial = measurement.samples[0].workers;
  const returned = measurement.samples[4].workers;
  if (
    !(returned?.completedTasks > initial?.completedTasks) ||
    !(returned?.submittedTasks > initial?.submittedTasks) ||
    !(returned?.kernel?.calls > initial?.kernel?.calls) ||
    measurement.samples.some(({ workers }) => workers?.failedTasks !== 0 || workers.kernel?.failures !== 0)
  )
    fail('Worker/Wasm did not execute successful route work');
  if (
    expected.benchmark &&
    measurement.samples.some(
      ({ frame }) =>
        !frame ||
        !Number.isSafeInteger(frame.count) ||
        frame.count < 1 ||
        ['p50Ms', 'p95Ms', 'p99Ms', 'longFrameCount'].some((key) => !Number.isFinite(frame[key]) || frame[key] < 0),
    )
  )
    fail('invalid runtime frame samples');
  const traces = new Map();
  for (const event of attempt.trace?.traceEvents ?? []) {
    if (!event.args?.traceId || !event.args?.traceName) continue;
    const marks = traces.get(event.args.traceId) ?? new Set();
    marks.add(event.name);
    traces.set(event.args.traceId, marks);
  }
  if (
    ![...traces.values()].some((marks) =>
      ['worker-start', 'worker-complete', 'commit-queued', 'visible-postrender'].every((mark) => marks.has(mark)),
    )
  )
    fail('no correlated Worker result consumed through postrender');
  return attempt;
}
