import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { acceptBaseline, assertBaselineRunId, baselineCandidate } from '../../../../../scripts/harness/baseline.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const measured = (evidencePath = 'harness/results/windows/window-1.json') => ({
  status: 'MEASURED',
  runId: 'mesh-example',
  owner: 'stdlib-world',
  scenario: 'mesh-corpus-v1',
  windowId: 'window-1',
  evidencePath,
  sampleStartedAt: '2026-09-11T10:00:01.000Z',
  sampleCompletedAt: '2026-09-11T10:00:02.000Z',
  sourceSha: 'a'.repeat(40),
  sourceDigest: 'b'.repeat(64),
  lockDigest: 'c'.repeat(64),
  bundleDigest: 'd'.repeat(64),
  environment: { node: 'v24', cpu: 'fixture' },
  samples: [{ totalMs: 10 }, { totalMs: 11 }],
});

it('rejects a self-declared MEASURED record without an external successful window receipt', () => {
  const root = mkdtempSync(join(tmpdir(), 'seedlands-baseline-window-missing-'));
  roots.push(root);
  expect(() => baselineCandidate(measured(), { rootDirectory: root })).toThrow(/window receipt/i);
});

it('binds the candidate to one successful covering window and exact measurement digest', () => {
  const root = mkdtempSync(join(tmpdir(), 'seedlands-baseline-window-valid-'));
  roots.push(root);
  const record = measured();
  const path = join(root, record.evidencePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({
      schemaVersion: 1,
      kind: 'seedlands-performance-window',
      status: 'PASS',
      windowId: record.windowId,
      startedAt: '2026-09-11T10:00:00.000Z',
      endedAt: '2026-09-11T10:00:03.000Z',
      exitCode: 0,
      measurement: {
        status: 'RECORDED',
        digest: digest(record),
        runId: record.runId,
        owner: record.owner,
        scenario: record.scenario,
        sampleStartedAt: record.sampleStartedAt,
        sampleCompletedAt: record.sampleCompletedAt,
        sourceSha: record.sourceSha,
        sourceDigest: record.sourceDigest,
        lockDigest: record.lockDigest,
        artifactDigest: record.bundleDigest,
      },
    })}\n`,
  );

  expect(baselineCandidate(record, { rootDirectory: root }).run).toEqual(record);
  expect(() => assertBaselineRunId('other-run', record)).toThrow(/CLI --run/);
  expect(() => assertBaselineRunId(record.runId, record)).not.toThrow();
  expect(() => baselineCandidate({ ...record, runId: 'reused-run' }, { rootDirectory: root })).toThrow(
    /measurement proof/i,
  );
  expect(() =>
    baselineCandidate({ ...record, sampleCompletedAt: '2026-09-11T10:00:04.000Z' }, { rootDirectory: root }),
  ).toThrow(/cover/i);

  const candidate = baselineCandidate(record, { rootDirectory: root });
  const approved = createHash('sha256')
    .update(`${JSON.stringify(candidate, null, 2)}\n`)
    .digest('hex');
  writeFileSync(path, JSON.stringify({ status: 'FAIL' }));
  expect(() => acceptBaseline(candidate, approved, 'fixture approval', { rootDirectory: root })).toThrow(
    /window receipt/i,
  );
});
