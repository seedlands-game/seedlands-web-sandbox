import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { selectDeterministicScope } from './ci-deterministic-scope.mjs';

test('Kernel changes also select downstream stdlib behavior', () => {
  assert.deepEqual(selectDeterministicScope('pull_request', ['packages/kernel/src/execution/kernel-runtime.ts']), {
    runKernel: true,
    runStdlib: true,
    reason: 'kernel-and-downstream-stdlib',
  });
});

test('stdlib-only changes do not select upstream Kernel behavior', () => {
  assert.deepEqual(selectDeterministicScope('pull_request', ['packages/stdlib/tests/world/voxel.test.ts']), {
    runKernel: false,
    runStdlib: true,
    reason: 'stdlib-change',
  });
});

test('shared changes, main push, and an empty PR diff run both owners', () => {
  for (const path of [
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.test.json',
    '.github/workflows/ci.yml',
    'packages/eslint-plugin/src/package-boundary-rule.mjs',
    'scripts/ci-deterministic-scope.mjs',
  ]) {
    const scope = selectDeterministicScope('pull_request', [path]);
    assert.equal(scope.runKernel, true, path);
    assert.equal(scope.runStdlib, true, path);
  }
  assert.equal(selectDeterministicScope('push', []).runStdlib, true);
  assert.equal(selectDeterministicScope('pull_request', []).runStdlib, true);
});

test('unrelated changes omit behavior tests without affecting the separate static job', () => {
  assert.deepEqual(selectDeterministicScope('pull_request', ['docs/ci-testing.md']), {
    runKernel: false,
    runStdlib: false,
    reason: 'no-deterministic-owner-change',
  });
  assert.equal(selectDeterministicScope('pull_request', ['apps/web/src/main.ts']).runStdlib, false);
  assert.equal(selectDeterministicScope('pull_request', ['playbooks/classic/src/index.ts']).runStdlib, false);
});

test('unknown source paths conservatively select both owners', () => {
  assert.deepEqual(selectDeterministicScope('pull_request', ['crates/world-kernels/src/lib.rs']), {
    runKernel: true,
    runStdlib: true,
    reason: 'unowned-change',
  });
});

test('invalid path input fails instead of selecting no tests', () => {
  assert.throws(() => selectDeterministicScope('pull_request', ['../packages/kernel/src/index.ts']));
  assert.throws(() => selectDeterministicScope('pull_request', ['']));
});

test('CLI accepts NUL-separated paths and emits stable GitHub outputs', () => {
  const result = spawnSync(process.execPath, ['scripts/ci-deterministic-scope.mjs', '--event', 'pull_request'], {
    input: Buffer.from('packages/kernel/src/index.ts\0docs/ci-testing.md\0'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'run_kernel=true\nrun_stdlib=true\nreason=kernel-and-downstream-stdlib\n');
});

test('CLI rejects malformed NUL input', () => {
  const result = spawnSync(process.execPath, ['scripts/ci-deterministic-scope.mjs', '--event', 'pull_request'], {
    input: 'packages/kernel/src/index.ts',
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /NUL-terminated/);
});
