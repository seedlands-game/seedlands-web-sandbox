import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  ftruncateSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { evaluateEntries } from './git-artifact-budget.mjs';

const mib = 1024 ** 2;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'scripts/git-artifact-budget.mjs');
const trace = 'changes/2026-10-12-example/evidence/run/canonical-trace.zip.part-aa';

// cwd alone cannot override GIT_DIR/GIT_INDEX_FILE; clear all inherited Git controls.
const isolatedGitEnvironment = (env) =>
  Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_')));

const repository = (t, inheritedEnv = process.env) => {
  const env = {
    ...isolatedGitEnvironment(inheritedEnv),
    GIT_AUTHOR_NAME: 'Artifact Test',
    GIT_AUTHOR_EMAIL: 'artifact-test@example.invalid',
    GIT_COMMITTER_NAME: 'Artifact Test',
    GIT_COMMITTER_EMAIL: 'artifact-test@example.invalid',
  };
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'seedlands-artifact-budget-')));
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd: path,
      encoding: 'utf8',
      env,
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (name, content = 'fixture') => {
    const target = join(path, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  const check = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: path, encoding: 'utf8', env });
  git('init', '-q', '--initial-branch=main');
  git('commit', '--allow-empty', '-qm', 'test: initial');
  // The path is independently resolved above; only this owned temporary fixture is removed.
  t.after(() => {
    assert.equal(realpathSync(path), path);
    assert.ok(path.startsWith(realpathSync(tmpdir()) + '/seedlands-artifact-budget-'));
    rmSync(path, { recursive: true });
  });
  return { git, write, check, path };
};

const classify = (path, size) => evaluateEntries([{ path, size }]);

test('small source, curated reports, manifests and source ZIP fixtures pass', () => {
  for (const path of [
    'src/code.ts',
    'reports/run/report.md',
    'changes/example/evidence/run/manifest.json',
    'reports/run/trace-manifest.json',
    'reports/run/browser.manifest.json',
    'apps/web/public/textures/frame.png',
    'fixtures/input.zip',
  ]) {
    assert.deepEqual(classify(path, 128), []);
  }
});

test('process output is rejected regardless of extension or size', () => {
  for (const path of [
    'changes/example/evidence/frame.png',
    'changes/example/evidence/run/output.log',
    'changes/example/evidence/run/result.json',
    'reports/run/events.jsonl',
    'reports/run/raw.txt',
    'reports/run/bundle.tar.gz',
    'reports/run/manifest.json.png',
    'reports/run/manifest.json/payload.bin',
    'harness/results/run/report.md',
    'playwright-report/index.html',
    'test-results/run/manifest.json',
    'midscene_run/run/frame.jpeg',
  ]) {
    assert.equal(classify(path, 1)[0]?.level, 'error', path);
  }
});

test('forced process screenshots fail in both index and intermediate commit history', (t) => {
  const repo = repository(t);
  const base = repo.git('rev-parse', 'HEAD');
  const screenshot = 'changes/example/evidence/run/frame.png';
  repo.write(screenshot);
  repo.git('add', '-f', '--', screenshot);
  assert.equal(repo.check('--staged').status, 1);
  repo.git('commit', '-qm', 'test: process screenshot');
  repo.git('rm', '--', screenshot);
  repo.git('commit', '-qm', 'test: remove process screenshot');
  assert.equal(repo.check('--base', base, '--head', 'HEAD').status, 1);
});

test('uncompressed byte limits have exact warning and rejection boundaries', () => {
  assert.deepEqual(classify('asset.bin', 10 * mib), []);
  assert.equal(classify('asset.bin', 10 * mib + 1)[0].level, 'warning');
  assert.equal(classify('asset.bin', 50 * mib)[0].level, 'warning');
  assert.equal(classify('asset.bin', 50 * mib + 1)[0].level, 'error');
});

test('tiny trace ZIPs, split ZIPs and evidence recordings cannot evade the budget', () => {
  for (const path of [
    trace,
    'trace.zip',
    'debug/TRACE.ZIP.001',
    'debug/bundle.zip.part-00',
    'reports/run/output.zip',
    'changes/example/evidence/run/recording.webm',
    'harness/results/run/capture.mp4',
  ]) {
    assert.equal(classify(path, 1)[0]?.level, 'error', path);
  }
});

test('staged check uses the index even if the working file is deleted', (t) => {
  const repo = repository(t);
  repo.write(trace);
  repo.git('add', '-f', '--', trace);
  const target = realpathSync(join(repo.path, trace));
  assert.equal(target, join(repo.path, trace));
  rmSync(target);
  const result = repo.check('--staged');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /canonical-trace/);
});

test('unstaged trace is ignored while staged Chinese, tabs and newline paths remain intact', (t) => {
  const repo = repository(t);
  repo.write(trace);
  const name = 'reports/中文 空格\t换行\nreport.md';
  repo.write(name, '{}');
  repo.git('add', '--', name);
  assert.equal(repo.check('--staged').status, 0);
  repo.write('reports/中文 空格\t换行\ntrace.zip.part-aa');
  repo.git('add', '--', 'reports/中文 空格\t换行\ntrace.zip.part-aa');
  const result = repo.check('--staged');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\\t/);
  assert.match(result.stderr, /\\n/);
});

test('commit range catches an artifact added then deleted before HEAD', (t) => {
  const repo = repository(t);
  const base = repo.git('rev-parse', 'HEAD');
  repo.write(trace);
  repo.git('add', '--', trace);
  repo.git('commit', '-qm', 'test: add trace');
  repo.git('rm', '-q', '--', trace);
  repo.git('commit', '-qm', 'test: remove trace');
  const result = repo.check('--base', base, '--head', repo.git('rev-parse', 'HEAD'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /canonical-trace/);
});

test('unchanged baseline artifact is grandfathered but renamed copies are rejected', (t) => {
  const repo = repository(t);
  repo.write(trace);
  repo.git('add', '--', trace);
  repo.git('commit', '-qm', 'test: legacy artifact');
  const base = repo.git('rev-parse', 'HEAD');
  repo.write('docs/note.md');
  repo.git('add', '--', 'docs/note.md');
  repo.git('commit', '-qm', 'test: unrelated note');
  assert.equal(repo.check('--base', base, '--head', 'HEAD').status, 0);
  repo.git('mv', '--', trace, trace + 'b');
  repo.git('commit', '-qm', 'test: rename artifact');
  assert.equal(repo.check('--base', base, '--head', 'HEAD').status, 1);
});

test('deletion of a baseline artifact passes staged and range checks', (t) => {
  const repo = repository(t);
  repo.write(trace);
  repo.git('add', '--', trace);
  repo.git('commit', '-qm', 'test: legacy artifact');
  const base = repo.git('rev-parse', 'HEAD');
  repo.git('rm', '-q', '--', trace);
  assert.equal(repo.check('--staged').status, 0);
  repo.git('commit', '-qm', 'test: remove artifact');
  assert.equal(repo.check('--base', base, '--head', 'HEAD').status, 0);
});

test('merge checks include newly reachable side-branch commits', (t) => {
  const repo = repository(t);
  const base = repo.git('rev-parse', 'HEAD');
  repo.git('checkout', '-qb', 'side');
  repo.write(trace);
  repo.git('add', '--', trace);
  repo.git('commit', '-qm', 'test: side trace');
  repo.git('checkout', '-q', 'main');
  repo.write('note.md');
  repo.git('add', '--', 'note.md');
  repo.git('commit', '-qm', 'test: main note');
  repo.git('merge', '--no-ff', '-qm', 'test: merge', 'side');
  assert.equal(repo.check('--base', base, '--head', 'HEAD').status, 1);
});

test('invalid CLI modes, missing base and Git failure fail closed', (t) => {
  const repo = repository(t);
  for (const args of [
    [],
    ['--staged', '--base', 'HEAD'],
    ['--base', 'missing'],
    ['--base', '0'.repeat(40)],
    ['--unknown'],
  ]) {
    assert.equal(repo.check(...args).status, 1, JSON.stringify(args));
  }
  const result = spawnSync(process.execPath, [cli, '--staged'], {
    cwd: tmpdir(),
    encoding: 'utf8',
    env: isolatedGitEnvironment(process.env),
  });
  assert.equal(result.status, 1);
});

test('ignore rules reject process outputs but keep nested reports and manifests discoverable', () => {
  const result = spawnSync('git', ['check-ignore', '--no-index', '--stdin', '-z'], {
    cwd: root,
    env: isolatedGitEnvironment(process.env),
    input: Buffer.from(
      [
        trace,
        'changes/example/evidence/result.json',
        'changes/example/evidence/frame.png',
        'changes/example/evidence/run/recording.webm',
        'changes/example/evidence/nested/report.md',
        'changes/example/evidence/nested/manifest.json',
        'reports/run/trace-manifest.json',
        'reports/run/browser.manifest.json',
        'reports/run/events.jsonl',
        'reports/run/raw.txt',
        'reports/run/frame.png',
        'reports/run/report.md',
        'harness/results/run/report.md',
        'apps/web/public/textures/frame.png',
      ].join('\0') + '\0',
    ),
  });
  assert.equal(result.status, 0);
  assert.deepEqual(result.stdout.toString().split('\0').filter(Boolean), [
    trace,
    'changes/example/evidence/result.json',
    'changes/example/evidence/frame.png',
    'changes/example/evidence/run/recording.webm',
    'reports/run/events.jsonl',
    'reports/run/raw.txt',
    'reports/run/frame.png',
    'harness/results/run/report.md',
  ]);
});

test('real staged blob size rejects compressed zeros even after working tree shrinks', (t) => {
  const repo = repository(t);
  const file = join(repo.path, 'oversize.bin');
  const fd = openSync(file, 'w');
  ftruncateSync(fd, 50 * mib + 1);
  closeSync(fd);
  repo.git('add', '--', 'oversize.bin');
  repo.write('oversize.bin', 'now small on disk');
  const result = repo.check('--staged');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /52428801 bytes/);
  assert.match(result.stderr, /50 MiB/);
  repo.git('commit', '-qm', 'test: baseline large blob');
  const base = repo.git('rev-parse', 'HEAD');
  repo.write('note.md');
  repo.git('add', '--', 'note.md');
  repo.git('commit', '-qm', 'test: unchanged large blob');
  assert.equal(repo.check('--base', base, '--head', 'HEAD').status, 0);
  repo.git('mv', '--', 'oversize.bin', 'renamed.bin');
  // git mv uses the smaller working copy here: stage the original blob under the new path.
  const oid = repo.git('rev-parse', `${base}:oversize.bin`);
  repo.git('update-index', '--cacheinfo', `100644,${oid},renamed.bin`);
  repo.git('commit', '-qm', 'test: rename original large blob');
  assert.equal(repo.check('--base', base, '--head', 'HEAD').status, 1);
});

test('staged budget warning is nonblocking and uses exact raw bytes', (t) => {
  const repo = repository(t);
  const fd = openSync(join(repo.path, 'warning.bin'), 'w');
  ftruncateSync(fd, 10 * mib + 1);
  closeSync(fd);
  repo.git('add', '--', 'warning.bin');
  const result = repo.check('--staged');
  assert.equal(result.status, 0);
  assert.match(result.stderr, /WARNING.*10485761 bytes/);
});

test('changed baseline artifact is rejected and new repositories support staged checking', (t) => {
  const repo = repository(t);
  repo.write(trace);
  repo.git('add', '--', trace);
  repo.git('commit', '-qm', 'test: legacy trace');
  const base = repo.git('rev-parse', 'HEAD');
  repo.write(trace, 'changed');
  repo.git('add', '--', trace);
  repo.git('commit', '-qm', 'test: changed trace');
  assert.equal(repo.check('--base', base, '--head', 'HEAD').status, 1);
  repo.git('checkout', '--orphan', 'unborn');
  assert.equal(repo.check('--staged').status, 1);
});

test('unmerged index fails closed instead of treating conflicts as an empty diff', (t) => {
  const repo = repository(t);
  repo.write('conflict.txt');
  repo.git('add', '--', 'conflict.txt');
  const oid = repo.git('rev-parse', ':conflict.txt');
  const result = spawnSync('git', ['update-index', '--index-info'], {
    cwd: repo.path,
    encoding: 'utf8',
    env: isolatedGitEnvironment(process.env),
    input: `0 ${'0'.repeat(40)}\tconflict.txt\n100644 ${oid} 1\tconflict.txt\n100644 ${oid} 2\tconflict.txt\n100644 ${oid} 3\tconflict.txt\n`,
  });
  assert.equal(result.status, 0, result.stderr);
  const check = repo.check('--staged');
  assert.equal(check.status, 1);
  assert.match(check.stderr, /Unmerged index/);
});

test('a resolved unrelated base does not omit root commits on the head branch', (t) => {
  const repo = repository(t);
  const base = repo.git('rev-parse', 'HEAD');
  repo.git('checkout', '--orphan', 'independent');
  repo.write(trace);
  repo.git('add', '--', trace);
  repo.git('commit', '-qm', 'test: independent trace');
  assert.equal(repo.check('--base', base, '--head', 'HEAD').status, 1);
});

test('invalid metadata fails rather than silently skipping the byte budget', () => {
  for (const size of [-1, Number.NaN, Number.MAX_SAFE_INTEGER + 1, undefined]) {
    assert.throws(() => classify('file.bin', size), /Invalid Git artifact metadata/);
  }
});

test('submodule entries are not treated as missing blobs', (t) => {
  const repo = repository(t);
  const oid = repo.git('rev-parse', 'HEAD');
  repo.git('update-index', '--add', '--cacheinfo', `160000,${oid},vendor/submodule`);
  assert.equal(repo.check('--staged').status, 0);
});

test('pre-commit exits on budget failure before lint-staged or path checks', (t) => {
  const repo = repository(t);
  repo.write('bin/pnpm', '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\n[ "$1" != "check:git-artifacts" ]\n');
  chmodSync(join(repo.path, 'bin/pnpm'), 0o755);
  const log = join(repo.path, 'calls.txt');
  const result = spawnSync('sh', [join(root, '.husky/pre-commit')], {
    cwd: repo.path,
    encoding: 'utf8',
    env: {
      ...isolatedGitEnvironment(process.env),
      PATH: `${join(repo.path, 'bin')}:${process.env.PATH}`,
      CALL_LOG: log,
    },
  });
  assert.equal(result.status, 1);
  assert.equal(readFileSync(log, 'utf8'), 'check:git-artifacts --staged\n');
});

test('invalid UTF-8 metadata fails closed before grandfather path collisions', (t) => {
  const repo = repository(t);
  for (const invalidCommand of ['ls-tree', 'log', 'diff']) {
    repo.write(
      'bin/git',
      `#!${process.execPath}\nconst args = process.argv.slice(2);\nconst oid = 'a'.repeat(40);\nconst invalid = ${JSON.stringify(invalidCommand)};\nconst path = (command) => Buffer.concat([Buffer.from('reports/'), (command === invalid || (invalid === 'ls-tree' && command === 'log')) ? Buffer.from([command === 'ls-tree' ? 0xff : 0xfe]) : Buffer.from('valid'), Buffer.from('/trace.zip\\0')]);\nif (args.includes('rev-parse')) process.stdout.write('b'.repeat(40) + '\\n');\nelse if (args.includes('ls-tree')) process.stdout.write(Buffer.concat([Buffer.from('100644 blob ' + oid + '\\t'), path('ls-tree')]));\nelse if (args.includes('log') || args.includes('diff')) { const command = args.includes('log') ? 'log' : 'diff'; process.stdout.write(Buffer.concat([Buffer.from(':000000 100644 ' + '0'.repeat(40) + ' ' + oid + ' A\\0'), path(command)])); }\nelse if (args.includes('ls-files')) process.stdout.write('');\nelse if (args.includes('cat-file')) process.stdout.write(oid + ' blob 1\\n');\nelse process.exit(1);\n`,
    );
    chmodSync(join(repo.path, 'bin/git'), 0o755);
    const args = invalidCommand === 'diff' ? ['--staged'] : ['--base', 'base', '--head', 'head'];
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: repo.path,
      encoding: 'utf8',
      env: { ...isolatedGitEnvironment(process.env), PATH: `${join(repo.path, 'bin')}:${process.env.PATH}` },
    });
    assert.equal(result.status, 1, invalidCommand);
    assert.match(result.stderr, /not valid UTF-8/, invalidCommand);
  }
});

test('fixture Git and CLI ignore inherited repository and config variables', (t) => {
  const side = repository(t);
  side.write('sentinel.txt', 'preserve this index');
  side.git('add', '--', 'sentinel.txt');
  const head = side.git('rev-parse', 'HEAD');
  const index = readFileSync(join(side.path, '.git/index'));
  const poisonedEnv = {
    ...process.env,
    GIT_DIR: join(side.path, '.git'),
    GIT_COMMON_DIR: join(side.path, '.git'),
    GIT_WORK_TREE: side.path,
    GIT_INDEX_FILE: join(side.path, '.git/index'),
    GIT_OBJECT_DIRECTORY: join(side.path, '.git/objects'),
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: '/dev/null',
  };
  const repo = repository(t, poisonedEnv);
  repo.write(trace);
  repo.git('add', '--', trace);
  assert.equal(repo.check('--staged').status, 1);
  assert.equal(side.git('rev-parse', 'HEAD'), head);
  assert.deepEqual(readFileSync(join(side.path, '.git/index')), index);
  assert.equal(side.git('status', '--porcelain'), 'A  sentinel.txt');
});

test('a genuinely missing staged blob fails closed', (t) => {
  const repo = repository(t);
  repo.write('missing.bin');
  repo.git('add', '--', 'missing.bin');
  const oid = repo.git('rev-parse', ':missing.bin');
  const expected = join(repo.path, '.git/objects', oid.slice(0, 2), oid.slice(2));
  const target = realpathSync(expected);
  assert.equal(target, expected);
  assert.ok(target.startsWith(repo.path + '/.git/objects/'));
  rmSync(target);
  const result = repo.check('--staged');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing or invalid artifact blob|Git metadata query failed/);
});

test('safe files pass on an unborn branch', (t) => {
  const repo = repository(t);
  repo.git('checkout', '--orphan', 'clean');
  repo.write('note.md');
  repo.git('add', '--', 'note.md');
  assert.equal(repo.check('--staged').status, 0);
});

test('hook and architecture CI retain the required artifact gate', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['check:git-artifacts'], 'node scripts/git-artifact-budget.mjs');
  assert.match(pkg.scripts['verify:static:ci'], /pnpm test:git-artifacts/);
  assert.match(readFileSync(join(root, '.husky/pre-commit'), 'utf8'), /pnpm check:git-artifacts --staged/);
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /pnpm check:git-artifacts --base "\$BASE_SHA" --head "\$HEAD_SHA"/);
  assert.match(workflow, /needs: \[architecture, deterministic\]/);
});
