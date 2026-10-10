import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sourceIdentity } from './artifact.mjs';
import { readWorkingSnapshot } from './repository-snapshot.mjs';

test('artifact source identity filters historical paths before reads while preserving source and default snapshot identity', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'seedlands-artifact-source-'));
  const source = resolve(root, 'packages/example/index.ts');
  const historical = resolve(root, 'changes/example/evidence/history.json');
  try {
    fs.mkdirSync(resolve(root, 'packages/example'), { recursive: true });
    fs.mkdirSync(resolve(root, 'changes/example/evidence'), { recursive: true });
    fs.writeFileSync(source, 'export const value = 1;\n');
    fs.writeFileSync(historical, '{"fixture":1}\n');
    fs.writeFileSync(resolve(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Artifact Test',
        '-c',
        'user.email=artifact-test@example.invalid',
        'commit',
        '--quiet',
        '-m',
        'test: initialize isolated fixture',
      ],
      { cwd: root },
    );
    const before = readWorkingSnapshot(root);
    const originalRead = fs.readFileSync;
    const reads = [];
    const guard = mock.method(fs, 'readFileSync', (path, ...args) => {
      const absolute = resolve(String(path));
      reads.push(absolute);
      assert.notEqual(absolute, historical, 'Historical evidence must be filtered before any read.');
      return originalRead(path, ...args);
    });
    syncBuiltinESMExports();
    let identity;
    try {
      identity = sourceIdentity(root);
      assert.equal(identity.sourceSha, before.sha);
      // Frozen digest of the existing path-NUL-byteHash-NUL algorithm for this fixture.
      assert.equal(identity.sourceDigest, '17faaf7cdcd78741f201e2807af481fba64d8ffb1c5298596a5b1a04b5a257a7');
      assert.ok(reads.includes(source));
      fs.writeFileSync(historical, '{"fixture":2}\n');
      assert.deepEqual(sourceIdentity(root), identity);
      fs.writeFileSync(source, 'export const value = 2;\n');
      assert.notEqual(sourceIdentity(root).sourceDigest, identity.sourceDigest);
    } finally {
      guard.mock.restore();
      syncBuiltinESMExports();
    }
    const after = readWorkingSnapshot(root);
    assert.equal(after.files['changes/example/evidence/history.json'], '{"fixture":2}\n');
    assert.notEqual(after.worktreeDigest, before.worktreeDigest);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
