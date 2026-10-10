import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const checkouts = [...workflow.matchAll(/sparse-checkout: \|\n((?: {12}[^\n]+\n)+)/g)].map((match) =>
  match[1]
    .trim()
    .split('\n')
    .map((line) => line.trim()),
);
const legacy = 'changes/2026-09-23-classic-functional-completion/evidence';
const identity = `${legacy}/v2-death-mixed-series-01/pre-death-v4-identity.json`;
const kept = [
  'package.json',
  '.github/workflows/ci.yml',
  'apps/web/src/example.ts',
  'packages/stdlib/src/example.ts',
  'playbooks/classic/src/example.ts',
  'docs/quality.md',
  'changes/older/spec.md',
  'changes/older/tasks.md',
  identity,
  'changes/2026-10-08-pr41-ci-recovery/spec.md',
  'changes/2026-10-08-pr41-ci-recovery/evidence/checkpoint.md',
];
const excluded = [
  'archives/example.zip',
  'reports/example.json',
  'harness/results/example.json',
  `${legacy}/browser-old/trace.zip`,
  `${legacy}/browser-old/nested/video.webm`,
  `${legacy}/v2-death-mixed-series-01/large-trace.zip`,
  'changes/older/evidence/trace.zip',
];

test('every CI checkout keeps exact source and specs without materializing sealed artifact trees', () => {
  assert.equal(checkouts.length, 5);
  assert.equal((workflow.match(/sparse-checkout-cone-mode: false/g) ?? []).length, 5);
  assert.doesNotMatch(workflow, /^\s+filter:/m, 'explicit filter overrides the action sparse-checkout input');
  const root = mkdtempSync(join(tmpdir(), 'seedlands-ci-sparse-fixture-'));
  const git = (args, input) => execFileSync('git', args, { cwd: root, encoding: 'utf8', input });
  try {
    git(['init', '--quiet']);
    for (const path of [...kept, ...excluded]) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), `fixture:${path}\n`);
    }
    git(['add', '.']);
    git([
      '-c',
      'user.name=Sparse fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ]);
    for (const patterns of checkouts) {
      git(['sparse-checkout', 'set', '--no-cone', '--stdin'], `${patterns.join('\n')}\n`);
      for (const path of kept) assert.equal(existsSync(join(root, path)), true, `missing required ${path}`);
      for (const path of excluded) {
        assert.equal(existsSync(join(root, path)), false, `materialized sealed artifact ${path}`);
        assert.equal(git(['ls-files', '-v', '--', path]), `S ${path}\n`);
        assert.equal(git(['show', `HEAD:${path}`]), `fixture:${path}\n`);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
