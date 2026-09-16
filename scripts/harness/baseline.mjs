import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceIdentity, verifyArtifact, root } from './artifact.mjs';
import { assertMeasurementWindow } from './performance-window-proof.mjs';
const digest = (value) => createHash('sha256').update(value).digest('hex');
export function assertBaselineRunId(runId, record) {
  if (!runId || record?.runId !== runId) throw new Error('CLI --run must match the measured record runId.');
}
export function baselineCandidate(record, options) {
  if (
    !record ||
    record.status !== 'MEASURED' ||
    !/^[a-z0-9-]+$/.test(record.runId) ||
    !/^[a-z0-9-]+$/.test(record.owner) ||
    !/^[a-z0-9-]+$/.test(record.scenario)
  )
    throw new Error('A measured versioned run is required.');
  if (
    !/^[0-9a-f]{40}$/.test(record.sourceSha) ||
    !/^[0-9a-f]{64}$/.test(record.sourceDigest) ||
    !/^[0-9a-f]{64}$/.test(record.lockDigest)
  )
    throw new Error('Missing source, bundle, lock or environment identity.');
  if (record.owner === 'web-runtime') {
    if (
      !/^[0-9a-f]{64}$/.test(record.artifactDigest) ||
      !record.environment?.userAgent ||
      !record.environment?.webgl2?.renderer ||
      !(record.environment.viewport?.width > 0) ||
      !(record.environment.viewport?.height > 0) ||
      !(record.environment.devicePixelRatio > 0)
    )
      throw new Error('Missing runtime artifact or browser environment identity.');
    if (
      !Array.isArray(record.samples) ||
      record.samples.map((sample) => sample.stage).join(',') !== 'C0,C1,C2,C3,C4,C5' ||
      record.samples.some(
        (sample) =>
          !Number.isFinite(sample.frame?.count) ||
          sample.frame.count < 1 ||
          ['p50Ms', 'p95Ms', 'p99Ms', 'longFrameCount'].some(
            (key) => !Number.isFinite(sample.frame[key]) || sample.frame[key] < 0,
          ),
      )
    )
      throw new Error('Incomplete or invalid runtime stage measurements.');
  } else {
    if (!/^[0-9a-f]{64}$/.test(record.bundleDigest) || !record.environment?.node || !record.environment?.cpu)
      throw new Error('Missing local bundle or environment identity.');
    if (
      !Array.isArray(record.samples) ||
      record.samples.length < 2 ||
      record.samples.some((sample) => !Number.isFinite(sample.totalMs) || sample.totalMs <= 0)
    )
      throw new Error('Insufficient or invalid raw samples.');
  }
  assertMeasurementWindow(record, options);
  return {
    schemaVersion: 1,
    status: 'CANDIDATE',
    run: record,
    comparison: 'NEW_VERSION_REQUIRES_REVIEW',
    predecessor: {
      path: 'harness/baseline.json',
      status: 'NOT_COMPARABLE',
      reason:
        'The former mixed benchmark and the new owner/scenario measurement have different boundaries; no performance gain is inferred.',
    },
  };
}
export function acceptBaseline(candidate, approvedDigest, reason, options) {
  const text = JSON.stringify(candidate, null, 2) + '\n';
  if (digest(text) !== approvedDigest || !reason?.trim())
    throw new Error('Exact candidate digest and acceptance reason are required.');
  if (candidate.status !== 'CANDIDATE') throw new Error('Not a candidate.');
  baselineCandidate(candidate.run, options);
  return {
    ...candidate,
    status: 'ACCEPTED',
    candidateDigest: approvedDigest,
    reason,
    acceptedAt: new Date().toISOString(),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  if (args.includes('--help')) {
    process.stdout.write('baseline --run <measured-run-id> [--accept --candidate-sha <sha256> --reason <reason>]\n');
    process.exit(0);
  }
  const value = (key) => {
    const at = args.indexOf(key);
    return at < 0 ? undefined : args[at + 1];
  };
  const runId = value('--run');
  if (!runId || !/^[a-z0-9-]+$/.test(runId)) throw new Error('Use --run <measured-run-id>.');
  const directory = resolve(root, 'harness/results', runId);
  if (args.includes('--accept')) {
    const candidate = JSON.parse(readFileSync(resolve(directory, 'baseline-candidate.json'), 'utf8'));
    assertBaselineRunId(runId, candidate.run);
    const current = sourceIdentity();
    for (const key of ['sourceSha', 'sourceDigest', 'lockDigest'])
      if (candidate.run[key] !== current[key]) throw new Error(`Stale baseline candidate: ${key}`);
    if (candidate.run.owner === 'web-runtime' && candidate.run.artifactDigest !== verifyArtifact().artifactDigest)
      throw new Error('Stale runtime artifact candidate.');
    const accepted = acceptBaseline(candidate, value('--candidate-sha'), value('--reason'));
    const target = resolve(root, 'harness/baselines', accepted.run.owner, accepted.run.scenario);
    mkdirSync(target, { recursive: true });
    writeFileSync(resolve(target, `${runId}.json`), JSON.stringify(accepted, null, 2) + '\n', { flag: 'wx' });
    process.stdout.write(`Accepted immutable baseline ${target}/${runId}.json\n`);
  } else {
    let measured;
    if (existsSync(resolve(directory, 'local.json'))) {
      measured = JSON.parse(readFileSync(resolve(directory, 'local.json'), 'utf8'));
    } else {
      const result = JSON.parse(readFileSync(resolve(directory, 'result.json'), 'utf8'));
      const classic = result.classic;
      if (
        result.stage !== 'runtime' ||
        result.status !== 'PASS' ||
        classic?.status !== 'PASS' ||
        classic.attempts?.length !== 1 ||
        classic.attempts[0].status !== 'PASS'
      )
        throw new Error('A single complete successful runtime measurement is required.');
      measured = classic.attempts[0].benchmark?.measurement;
    }
    assertBaselineRunId(runId, measured);
    const candidate = baselineCandidate(measured);
    const text = JSON.stringify(candidate, null, 2) + '\n';
    writeFileSync(resolve(directory, 'baseline-candidate.json'), text, { flag: 'wx' });
    process.stdout.write(`CANDIDATE sha256=${digest(text)}; no accepted baseline changed.\n`);
  }
}
