import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import CanonicalReporter from './canonical-reporter';
import { canonicalMainIdentity } from '../../../../../scripts/harness/classic-receipt.mjs';

const temporaryPaths: string[] = [];
const runId = 'reporter-test-run';
const sourceSha = 'b'.repeat(40);

const config = { rootDir: process.cwd() } as FullConfig;
const project = { name: canonicalMainIdentity.project };
const testCase = (title = canonicalMainIdentity.title, file = canonicalMainIdentity.file) =>
  ({
    id: title === canonicalMainIdentity.title ? 'canonical-id' : 'other-id',
    title,
    location: { file: join(process.cwd(), file), line: 1, column: 1 },
    parent: { project: () => project },
  }) as TestCase;
const suite = (...tests: TestCase[]) => ({ allTests: () => tests }) as Suite;
const attachment = (name: string, payload: unknown) => ({
  name,
  contentType: 'application/json',
  body: Buffer.from(JSON.stringify(payload)),
});
const detailed = {
  schemaVersion: 1,
  status: 'PASS',
  attempt: 0,
  test: canonicalMainIdentity.title,
  project: canonicalMainIdentity.project,
  runId,
  artifact: { identity: { sourceSha } },
  benchmark: { measurement: { status: 'NOT_MEASURED' } },
  stages: { C5: { status: 'PASS' } },
  restoreEvidence: { after: { v2Equipment: { phase: 'restored' } } },
};
const result = (status: TestResult['status'], attachments: TestResult['attachments'], retry = 0): TestResult =>
  ({
    status,
    retry,
    attachments,
    errors: status === 'passed' ? [] : [{ message: `result:${status}` }],
  }) as TestResult;

afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

function destination() {
  const directory = join(tmpdir(), `seedlands-canonical-reporter-${process.pid}-${temporaryPaths.length}`);
  temporaryPaths.push(directory);
  mkdirSync(directory);
  return join(directory, 'classic.json');
}

function reporter(path: string) {
  vi.stubEnv('SEEDLANDS_CLASSIC_RESULT', path);
  vi.stubEnv('SEEDLANDS_HARNESS_RUN_ID', runId);
  vi.stubEnv('SEEDLANDS_SOURCE_SHA', sourceSha);
  return new CanonicalReporter();
}

describe('CanonicalReporter', () => {
  it('writes one terminal main attempt from the completed Playwright result and attachments', () => {
    const path = destination();
    const instance = reporter(path);
    const main = testCase();
    instance.onBegin(config, suite(main));
    instance.onTestEnd(
      main,
      result('timedOut', [
        attachment('classic-runtime-failure.json', { ...detailed, status: 'FAIL', errors: ['timeout'] }),
        attachment('classic-runtime-evidence.json', detailed),
      ]),
    );
    expect(instance.onEnd({ status: 'failed' } as FullResult)).toBeUndefined();

    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    expect(receipt.status).toBe('FAIL');
    expect(receipt.runnerOutcome).toBe('failed');
    expect(receipt.attempts).toHaveLength(1);
    expect(receipt.attempts[0]).toMatchObject({
      testOutcome: 'timedOut',
      assertionEvidenceStatus: 'PASS',
      stages: detailed.stages,
      restoreEvidence: detailed.restoreEvidence,
      failureEvidence: { errors: ['timeout'] },
    });
  });

  it('uses the filtered suite and excludes visual and skipped non-main tests from attempts', () => {
    const path = destination();
    const instance = reporter(path);
    const visual = testCase('Classic 视觉 v3 生产素材、连续帧与单击破坏回归');
    const modular = testCase(
      '非 Classic Playbook 从锁定 production artifact 启动并消费自定义 worldgen/voxel/presentation',
    );
    instance.onBegin(config, suite(visual, modular));
    instance.onTestEnd(visual, result('passed', [attachment('classic-runtime-evidence.json', detailed)]));
    instance.onTestEnd(modular, result('skipped', []));
    instance.onEnd({ status: 'passed' } as FullResult);

    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    expect(receipt).toMatchObject({ status: 'PASS', runnerOutcome: 'passed', selection: { mode: 'NON_MAIN' } });
    expect(receipt.attempts).toEqual([]);
  });

  it('reads file-backed attachments and fails closed on malformed evidence', () => {
    const path = destination();
    const detailedPath = path + '.detailed.json';
    writeFileSync(detailedPath, JSON.stringify(detailed));
    const instance = reporter(path);
    const main = testCase();
    instance.onBegin(config, suite(main));
    instance.onTestEnd(
      main,
      result('passed', [
        { name: 'classic-runtime-evidence.json', contentType: 'application/json', path: detailedPath },
        { name: 'classic-runtime-failure.json', contentType: 'application/json', body: Buffer.from('{') },
      ]),
    );
    instance.onEnd({ status: 'passed' } as FullResult);

    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    expect(receipt.status).toBe('FAIL');
    expect(receipt.attempts).toHaveLength(1);
    expect(receipt.attempts[0]).toMatchObject({
      assertionEvidenceStatus: 'PASS',
      failureEvidence: null,
      receiptErrors: ['classic-runtime-failure.json is not valid readable JSON'],
    });
  });

  it('marks a modular-world selection without accepting a canonical main attempt', () => {
    const path = destination();
    vi.stubEnv('SEEDLANDS_PACK_SMOKE', 'modular-world');
    const instance = reporter(path);
    const main = testCase();
    const modular = testCase(
      '非 Classic Playbook 从锁定 production artifact 启动并消费自定义 worldgen/voxel/presentation',
    );
    instance.onBegin(config, suite(main, modular));
    instance.onTestEnd(main, result('skipped', []));
    instance.onTestEnd(modular, result('passed', []));
    instance.onEnd({ status: 'passed' } as FullResult);

    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    expect(receipt).toMatchObject({ status: 'PASS', selection: { mode: 'MODULAR_WORLD' }, attempts: [] });
  });
});
