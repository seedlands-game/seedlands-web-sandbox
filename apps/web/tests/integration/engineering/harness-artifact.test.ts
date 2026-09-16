import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { distFiles, sourceIdentity, verifyArtifact } from '../../../../../scripts/harness/artifact.mjs';
import { baselineCandidate, acceptBaseline } from '../../../../../scripts/harness/baseline.mjs';
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function withWindowProof<T extends Record<string, unknown>>(root: string, record: T) {
  const windowId = `window-${String(record.runId)}`;
  const evidencePath = `harness/results/performance-windows/${windowId}.json`;
  const measured = {
    ...record,
    windowId,
    evidencePath,
    sampleStartedAt: '2026-09-11T10:00:01.000Z',
    sampleCompletedAt: '2026-09-11T10:00:02.000Z',
  };
  const receiptPath = join(root, evidencePath);
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(
    receiptPath,
    `${JSON.stringify({
      schemaVersion: 1,
      kind: 'seedlands-performance-window',
      status: 'PASS',
      windowId,
      startedAt: '2026-09-11T10:00:00.000Z',
      endedAt: '2026-09-11T10:00:03.000Z',
      exitCode: 0,
      measurement: {
        status: 'RECORDED',
        digest: hash(JSON.stringify(measured)),
        runId: measured.runId,
        owner: measured.owner,
        scenario: measured.scenario,
        sampleStartedAt: measured.sampleStartedAt,
        sampleCompletedAt: measured.sampleCompletedAt,
        sourceSha: measured.sourceSha,
        sourceDigest: measured.sourceDigest,
        lockDigest: measured.lockDigest,
        artifactDigest: measured.artifactDigest ?? measured.bundleDigest,
      },
    })}\n`,
  );
  return measured;
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'seedlands-artifact-contract-'));
  roots.push(root);
  mkdirSync(join(root, 'apps/web/src'), { recursive: true });
  mkdirSync(join(root, 'apps/web/dist/packs'), { recursive: true });
  writeFileSync(join(root, 'apps/web/src/main.ts'), 'export const version = 1;');
  writeFileSync(join(root, 'apps/web/index.html'), '<html>main source</html>');
  writeFileSync(join(root, 'apps/web/asset-workbench.html'), '<html>workbench source</html>');
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0');
  for (const [path, text] of [
    ['index.html', '<html></html>'],
    ['test.wasm', 'wasm'],
    ['packs/packs.lock.json', '{}'],
  ])
    writeFileSync(join(root, 'apps/web/dist', path!), text!);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
  const files = distFiles(join(root, 'apps/web/dist'));
  writeFileSync(
    join(root, 'apps/web/dist/harness-artifact.json'),
    JSON.stringify({ schemaVersion: 1, ...sourceIdentity(root), artifactDigest: hash(JSON.stringify(files)), files }),
  );
  return root;
}
it('accepts exact source and production bytes and rejects changed source', () => {
  const root = fixture();
  expect(verifyArtifact(root).sourceSha).toMatch(/^[a-f0-9]{40}$/);
  writeFileSync(join(root, 'apps/web/src/main.ts'), 'export const version = 2;');
  expect(() => verifyArtifact(root)).toThrow('Stale production identity: sourceDigest');
});
it('rejects an artifact replaced after build and missing required runtime bytes', () => {
  const root = fixture();
  writeFileSync(join(root, 'apps/web/dist/test.wasm'), 'other-wasm');
  expect(() => verifyArtifact(root)).toThrow('Production artifact bytes changed');
  rmSync(join(root, 'apps/web/dist/test.wasm'));
  expect(() => distFiles(join(root, 'apps/web/dist'))).toThrow('Incomplete production artifact');
});
it.each(['index.html', 'asset-workbench.html'])('rejects a changed HTML production input: %s', (entry) => {
  const root = fixture();
  writeFileSync(join(root, 'apps/web', entry), '<html>changed build input</html>');
  expect(() => verifyArtifact(root)).toThrow('Stale production identity: sourceDigest');
});
it('requires a measured identity and an exact explicitly accepted candidate digest', () => {
  const root = fixture();
  const run = withWindowProof(root, {
    status: 'MEASURED',
    runId: 'mesh-example',
    owner: 'stdlib-world',
    scenario: 'mesh-corpus-v1',
    sourceSha: 'a'.repeat(40),
    sourceDigest: 'b'.repeat(64),
    lockDigest: 'c'.repeat(64),
    bundleDigest: 'd'.repeat(64),
    environment: { node: 'v22', cpu: 'fixture' },
    samples: [{ totalMs: 10 }, { totalMs: 11 }],
  });
  const candidate = baselineCandidate(run, { rootDirectory: root });
  expect(() => baselineCandidate({ ...run, sourceSha: 'unknown' }, { rootDirectory: root })).toThrow('identity');
  expect(() => acceptBaseline(candidate, 'e'.repeat(64), 'reviewed', { rootDirectory: root })).toThrow(
    'Exact candidate digest',
  );
  const approved = hash(JSON.stringify(candidate, null, 2) + '\n');
  expect(() => acceptBaseline(candidate, approved, '', { rootDirectory: root })).toThrow('reason');
  expect(acceptBaseline(candidate, approved, 'approved fixture', { rootDirectory: root })).toMatchObject({
    status: 'ACCEPTED',
    candidateDigest: approved,
  });
  expect(candidate.status).toBe('CANDIDATE');
});

it('keeps runtime frame samples separate from local timings and rejects missing stages or diagnostic runs', () => {
  const root = fixture();
  const measured = withWindowProof(root, {
    status: 'MEASURED',
    runId: 'classic-example',
    owner: 'web-runtime',
    scenario: 'classic-canonical-runtime-v1',
    sourceSha: 'a'.repeat(40),
    sourceDigest: 'b'.repeat(64),
    lockDigest: 'c'.repeat(64),
    artifactDigest: 'd'.repeat(64),
    environment: {
      userAgent: 'Chromium fixture',
      webgl2: { renderer: 'fixture' },
      viewport: { width: 1280, height: 720 },
      devicePixelRatio: 1,
    },
    samples: ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'].map((stage) => ({
      stage,
      frame: { count: 10, p50Ms: 16, p95Ms: 20, p99Ms: 22, longFrameCount: 0 },
    })),
  });
  expect(baselineCandidate(measured, { rootDirectory: root }).run).toEqual(measured);
  expect(() => baselineCandidate({ ...measured, status: 'DIAGNOSTIC' }, { rootDirectory: root })).toThrow('measured');
  expect(() => baselineCandidate({ ...measured, samples: measured.samples.slice(1) }, { rootDirectory: root })).toThrow(
    'stage measurements',
  );
  expect(() => baselineCandidate({ ...measured, artifactDigest: undefined }, { rootDirectory: root })).toThrow(
    'artifact',
  );
});
