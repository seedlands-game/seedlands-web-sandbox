import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  createCanonicalSelection,
  createClassicReceipt,
  finalizeClassicReceipt,
  recordCanonicalTestEnd,
  type ClassicEvidenceAttachment,
  type ClassicReceipt,
  type ClassicTestIdentity,
} from '../../../../../scripts/harness/classic-receipt.mjs';

const resultPath = () => (process.env.SEEDLANDS_CLASSIC_RESULT ? resolve(process.env.SEEDLANDS_CLASSIC_RESULT) : null);
const requiredEnvironment = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + ' is required by the Classic terminal reporter.');
  return value;
};
const normalizedFile = (rootDir: string, file: string) =>
  (isAbsolute(file) ? relative(rootDir, file) : file).split(sep).join('/');

function testIdentity(rootDir: string, test: TestCase): ClassicTestIdentity {
  return {
    testId: test.id,
    file: normalizedFile(rootDir, test.location.file),
    test: test.title,
    project: test.parent.project()?.name ?? '',
  };
}

function parseAttachment(attachment: TestResult['attachments'][number]): ClassicEvidenceAttachment | null {
  if (attachment.name !== 'classic-runtime-evidence.json' && attachment.name !== 'classic-runtime-failure.json')
    return null;
  try {
    const bytes = attachment.body ?? (attachment.path ? readFileSync(attachment.path) : null);
    if (!bytes) return { name: attachment.name, payload: null, error: 'has no body or readable path' };
    return { name: attachment.name, payload: JSON.parse(bytes.toString('utf8')) as unknown };
  } catch {
    return { name: attachment.name, payload: null, error: 'is not valid readable JSON' };
  }
}

export default class CanonicalReporter implements Reporter {
  private rootDir = '';
  private path: string | null = null;
  private receipt: ClassicReceipt | null = null;

  onBegin(config: FullConfig, suite: Suite): void {
    this.rootDir = config.rootDir;
    this.path = resultPath();
    if (!this.path) return;
    const selectedTests = suite.allTests().map((test) => testIdentity(this.rootDir, test));
    const selection = createCanonicalSelection(selectedTests, {
      modularWorld: process.env.SEEDLANDS_PACK_SMOKE === 'modular-world',
    });
    this.receipt = createClassicReceipt({
      runId: requiredEnvironment('SEEDLANDS_HARNESS_RUN_ID'),
      sourceSha: requiredEnvironment('SEEDLANDS_SOURCE_SHA'),
      selection,
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!this.receipt) return;
    this.receipt = recordCanonicalTestEnd(this.receipt, {
      ...testIdentity(this.rootDir, test),
      retry: result.retry,
      resultStatus: result.status,
      resultErrors: result.errors.map((error) => error.message ?? error.value ?? 'Unknown Playwright test error.'),
      attachments: result.attachments.flatMap((attachment) => {
        const parsed = parseAttachment(attachment);
        return parsed ? [parsed] : [];
      }),
    });
  }

  onEnd(result: FullResult): void {
    if (!this.path || !this.receipt) return;
    const receipt = finalizeClassicReceipt(this.receipt, result.status);
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = this.path + '.' + process.pid + '.tmp';
    writeFileSync(temporary, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    renameSync(temporary, this.path);
  }

  printsToStdio(): boolean {
    return false;
  }
}
