import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
});
