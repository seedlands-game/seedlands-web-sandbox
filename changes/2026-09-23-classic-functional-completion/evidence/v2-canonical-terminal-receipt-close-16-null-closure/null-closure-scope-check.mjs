import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const evidenceDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(evidenceDirectory, '../../../..');
const predecessor = resolve(evidenceDirectory, 'prior-release/files');
const unchanged = [
  'apps/web/tests/e2e/classic-runtime.spec.ts',
  'apps/web/tests/e2e/classic-support/evidence.ts',
  'apps/web/tests/e2e/classic-support/canonical-reporter.ts',
  'playwright.config.ts',
  'scripts/harness/classic.mjs',
  'scripts/harness/classic-receipt.d.mts',
  'changes/2026-09-23-classic-functional-completion/canonical-budget-contract.md',
  'changes/2026-09-23-classic-functional-completion/canonical-budget-evidence.md',
  'docs/code-map.md',
];
const changed = [
  'scripts/harness/classic-receipt.mjs',
  'scripts/harness/classic-receipt.test.mjs',
  'apps/web/tests/e2e/classic-support/canonical-reporter.test.ts',
  'changes/2026-09-23-classic-functional-completion/spec.md',
  'changes/2026-09-23-classic-functional-completion/canonical-terminal-receipt-contract.md',
  'changes/2026-09-23-classic-functional-completion/canonical-terminal-receipt-evidence.md',
];
const same = (path) => readFileSync(resolve(root, path)).equals(readFileSync(resolve(predecessor, path)));
for (const path of unchanged) if (!same(path)) throw new Error(`Unexpected null-closure change: ${path}`);
for (const path of changed) if (same(path)) throw new Error(`Expected null-closure change is absent: ${path}`);
if (execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' }).trim())
  throw new Error('Git index is not empty.');
const source = readFileSync(resolve(root, 'scripts/harness/classic-receipt.mjs'), 'utf8');
for (const token of [
  'const assertionEvidencePresent = detailed.length > 0',
  'const failureEvidencePresent = failures.length > 0',
  'const failureEvidence = failureEvidencePresent ? failures[0] : null',
  '!failureEvidencePresent',
  'failureEvidencePresent,',
])
  if (!source.includes(token)) throw new Error(`Presence token is missing: ${token}`);
if (Buffer.from(source).includes(0)) throw new Error('Receipt helper contains a NUL byte.');

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      status: 'PASS',
      predecessorSourceEntries: 15,
      unchangedPaths: unchanged,
      changedPaths: changed,
      reporterImplementationChanged: false,
      runnerChanged: false,
      budgetChanged: false,
      presenceAndPayloadSeparated: true,
      indexEmpty: true,
    },
    null,
    2,
  )}\n`,
);
