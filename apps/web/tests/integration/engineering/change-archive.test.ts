import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts/change-archive.mjs');
const roots: string[] = [];

const createFixture = async (status = 'Delivered') => {
  const root = await mkdtemp(join(tmpdir(), 'seedlands-change-archive-'));
  roots.push(root);
  await mkdir(join(root, 'changes/2026-09-01-example/e2e'), { recursive: true });
  await writeFile(join(root, 'changes/2026-09-01-example/spec.md'), `# 示例\n\n**状态：${status}。**\n`);
  await writeFile(join(root, 'changes/2026-09-01-example/e2e/example.spec.ts'), 'export const preserved = true;\n');
  return root;
};

const createSymlinkArchive = async (root: string) => {
  const staging = await mkdtemp(join(tmpdir(), 'seedlands-change-archive-malicious-'));
  roots.push(staging);
  const external = join(root, 'external-content.txt');
  await writeFile(external, external);
  await mkdir(join(staging, 'changes/2026-09-01-example'), { recursive: true });
  await symlink(external, join(staging, 'changes/2026-09-01-example/escape.md'));
  const linkPayloadHash = createHash('sha256').update(external).digest('hex');
  await writeFile(
    join(staging, 'manifest.json'),
    `${JSON.stringify({ version: 1, entries: [{ path: 'changes/2026-09-01-example/escape.md', sha256: linkPayloadHash }] })}\n`,
  );
  await mkdir(join(root, 'archives/changes'), { recursive: true });
  execFileSync(
    'zip',
    ['-q', '-y', '-r', '-D', join(root, 'archives/changes/symlink.zip'), 'manifest.json', 'changes'],
    {
      cwd: staging,
    },
  );
};

const createDuplicateManifestArchive = async (root: string) => {
  const staging = await mkdtemp(join(tmpdir(), 'seedlands-change-archive-duplicate-'));
  roots.push(staging);
  await mkdir(join(staging, 'changes/2026-09-01-example'), { recursive: true });
  const content = 'duplicate manifest fixture\n';
  await writeFile(join(staging, 'changes/2026-09-01-example/spec.md'), content);
  const entry = {
    path: 'changes/2026-09-01-example/spec.md',
    sha256: createHash('sha256').update(content).digest('hex'),
  };
  await writeFile(join(staging, 'manifest.json'), `${JSON.stringify({ version: 1, entries: [entry, entry] })}\n`);
  await mkdir(join(root, 'archives/changes'), { recursive: true });
  execFileSync('zip', ['-q', '-r', '-D', join(root, 'archives/changes/duplicate.zip'), 'manifest.json', 'changes'], {
    cwd: staging,
  });
};

const run = (root: string, ...args: string[]) =>
  execFileSync(process.execPath, [script, '--root', root, ...args], { encoding: 'utf8' });

const commitFixture = (root: string) => {
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', 'changes']);
  execFileSync('git', [
    '-C',
    root,
    '-c',
    'user.name=Archive Test',
    '-c',
    'user.email=archive@example.invalid',
    'commit',
    '-qm',
    'baseline',
  ]);
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('change archive tool', () => {
  it('freezes every committed change at an exact baseline without relabeling historical status', async () => {
    const root = await createFixture('Active');
    const first = 'changes/2026-09-01-example';
    const second = 'changes/2026-09-02-proposed';
    await mkdir(join(root, second), { recursive: true });
    await writeFile(join(root, second, 'spec.md'), '# Historical proposal\n\n状态：Proposed\n');
    const firstSpec = await readFile(join(root, first, 'spec.md'));
    const baselineSha = commitFixture(root);
    const future = 'changes/2026-09-03-future';
    await mkdir(join(root, future), { recursive: true });
    await writeFile(join(root, future, 'spec.md'), '状态：Active\n');

    run(root, 'freeze', baselineSha, 'archives/changes/baseline.zip');
    expect(() => run(root, 'verify', 'archives/changes/baseline.zip')).not.toThrow();
    expect(await readFile(join(root, first, 'spec.md')).catch(() => null)).toBeNull();
    expect(await readFile(join(root, second, 'spec.md')).catch(() => null)).toBeNull();
    expect(await readFile(join(root, future, 'spec.md'), 'utf8')).toBe('状态：Active\n');
    run(root, 'extract', 'archives/changes/baseline.zip', 'restored/baseline');
    expect(await readFile(join(root, 'restored/baseline', first, 'spec.md'))).toEqual(firstSpec);
  });

  it('rejects a changed baseline source or an extra source file without deleting it', async () => {
    const dirtyRoot = await createFixture('Proposed');
    const baselineSha = commitFixture(dirtyRoot);
    const specPath = join(dirtyRoot, 'changes/2026-09-01-example/spec.md');
    await writeFile(specPath, '# changed\n');
    expect(() => run(dirtyRoot, 'freeze', baselineSha, 'archives/changes/dirty.zip')).toThrow();
    expect(await readFile(specPath, 'utf8')).toBe('# changed\n');

    const extraRoot = await createFixture('Proposed');
    const extraSha = commitFixture(extraRoot);
    const extraPath = join(extraRoot, 'changes/2026-09-01-example/extra.txt');
    await writeFile(extraPath, 'not in baseline\n');
    expect(() => run(extraRoot, 'freeze', extraSha, 'archives/changes/extra.zip')).toThrow();
    expect(await readFile(extraPath, 'utf8')).toBe('not in baseline\n');
  });

  it('rejects a different HEAD or an active script reference during baseline freeze', async () => {
    const wrongHeadRoot = await createFixture('Proposed');
    commitFixture(wrongHeadRoot);
    expect(() => run(wrongHeadRoot, 'freeze', '0'.repeat(40), 'archives/changes/wrong-head.zip')).toThrow();
    expect(await readFile(join(wrongHeadRoot, 'changes/2026-09-01-example/spec.md'), 'utf8')).toContain('Proposed');

    const referencedRoot = await createFixture('Proposed');
    const baselineSha = commitFixture(referencedRoot);
    await writeFile(
      join(referencedRoot, 'package.json'),
      '{"scripts":{"smoke":"changes/2026-09-01-example/e2e/example.spec.ts"}}\n',
    );
    expect(() => run(referencedRoot, 'freeze', baselineSha, 'archives/changes/referenced-freeze.zip')).toThrow();
    expect(await readFile(join(referencedRoot, 'changes/2026-09-01-example/spec.md'), 'utf8')).toContain('Proposed');
  });

  it('round-trips a delivered change with path and hash verification before removal', async () => {
    const root = await createFixture();
    const archive = 'archives/changes/first-batch.zip';

    run(root, 'archive', archive, 'changes/2026-09-01-example');
    expect(() => run(root, 'verify', archive)).not.toThrow();
    expect(await readFile(join(root, 'changes/2026-09-01-example/spec.md'), 'utf8').catch(() => null)).toBeNull();
    const restored = 'restored/first-batch';
    expect(run(root, 'extract', archive, restored)).toContain(restored);
    expect(await readFile(join(root, restored, 'changes/2026-09-01-example/e2e/example.spec.ts'), 'utf8')).toBe(
      'export const preserved = true;\n',
    );
    expect(() => run(root, 'extract', archive, restored)).toThrow();
  });

  it('rejects active, unsafe, referenced, and overwrite candidates without removing source', async () => {
    const activeRoot = await createFixture('Active');
    expect(() => run(activeRoot, 'archive', 'archives/changes/active.zip', 'changes/2026-09-01-example')).toThrow();
    expect(await readFile(join(activeRoot, 'changes/2026-09-01-example/spec.md'), 'utf8')).toContain('Active');

    const unsafeRoot = await createFixture();
    await writeFile(
      join(unsafeRoot, 'package.json'),
      '{"scripts":{"smoke":"changes/2026-09-01-example/e2e/example.spec.ts"}}\n',
    );
    expect(() => run(unsafeRoot, 'archive', 'archives/changes/referenced.zip', 'changes/2026-09-01-example')).toThrow();
    expect(() => run(unsafeRoot, 'archive', 'archives/changes/escape.zip', '../outside')).toThrow();
    expect(await readFile(join(unsafeRoot, 'changes/2026-09-01-example/spec.md'), 'utf8')).toContain('Delivered');

    await mkdir(join(unsafeRoot, 'archives/changes'), { recursive: true });
    await writeFile(join(unsafeRoot, 'archives/changes/existing.zip'), 'do-not-overwrite');
    expect(() => run(unsafeRoot, 'archive', 'archives/changes/existing.zip', 'changes/2026-09-01-example')).toThrow();
    expect(await readFile(join(unsafeRoot, 'archives/changes/existing.zip'), 'utf8')).toBe('do-not-overwrite');
  });

  it('rejects a change parent that is a symlink before reading or deleting an external source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seedlands-change-archive-root-'));
    const outside = await createFixture();
    roots.push(root);
    await symlink(join(outside, 'changes'), join(root, 'changes'));

    expect(() => run(root, 'archive', 'archives/changes/external.zip', 'changes/2026-09-01-example')).toThrow();
    expect(await readFile(join(outside, 'changes/2026-09-01-example/spec.md'), 'utf8')).toContain('Delivered');
  });

  it('rejects ZIP symlink entries before verification or extraction can follow them', async () => {
    const root = await createFixture();
    await createSymlinkArchive(root);
    const archive = 'archives/changes/symlink.zip';

    expect(() => run(root, 'verify', archive)).toThrow();
    expect(() => run(root, 'extract', archive, 'restored/symlink')).toThrow();
    expect(await lstat(join(root, 'restored/symlink')).catch(() => null)).toBeNull();
  });

  it('rejects duplicate manifest paths instead of collapsing them during verification', async () => {
    const root = await createFixture();
    await createDuplicateManifestArchive(root);

    expect(() => run(root, 'verify', 'archives/changes/duplicate.zip')).toThrow();
  });
});
