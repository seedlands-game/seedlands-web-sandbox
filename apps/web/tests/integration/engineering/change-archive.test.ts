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

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('change archive tool', () => {
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
