import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { checkFrozenEvidence, frozenEvidence } from './check-frozen-evidence.mjs';

const repository = resolve(import.meta.dirname, '..');

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'seedlands-frozen-evidence-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of Object.keys(frozenEvidence)) {
    const target = resolve(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, execFileSync('git', ['show', `HEAD:${path}`], { cwd: repository }));
  }
  return root;
}

test('original historical bytes pass in full and sparse checkouts', (t) => {
  assert.equal(checkFrozenEvidence(fixture(t)), 5);
  assert.equal(checkFrozenEvidence(repository), 5);
});

test('formatting or modifying any excluded evidence still fails the gate', (t) => {
  const root = fixture(t);
  for (const path of Object.keys(frozenEvidence)) {
    const target = resolve(root, path);
    const original = readFileSync(target);
    writeFileSync(target, Buffer.concat([original, Buffer.from('\n')]));
    assert.throws(() => checkFrozenEvidence(root), /bytes changed/);
    writeFileSync(target, original);
  }
});

test('missing evidence and symlink substitutions fail closed', (t) => {
  const root = fixture(t);
  const target = resolve(root, Object.keys(frozenEvidence)[0]);
  const bytes = readFileSync(target);
  rmSync(target);
  assert.throws(() => checkFrozenEvidence(root));
  const replacement = resolve(root, 'replacement.json');
  writeFileSync(replacement, bytes);
  symlinkSync(replacement, target);
  assert.throws(() => checkFrozenEvidence(root), /regular file/);
  rmSync(replacement);
  assert.throws(() => checkFrozenEvidence(root), /regular file/);
});

test('a dangling symlink cannot masquerade as an absent sparse file', (t) => {
  const root = fixture(t);
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git(['init', '-q']);
  git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  const path = Object.keys(frozenEvidence)[0];
  git(['update-index', '--skip-worktree', '--', path]);
  const target = resolve(root, path);
  rmSync(target);
  assert.equal(checkFrozenEvidence(root), 5);
  symlinkSync(resolve(root, 'missing-target'), target);
  assert.throws(() => checkFrozenEvidence(root), /regular file/);
});
