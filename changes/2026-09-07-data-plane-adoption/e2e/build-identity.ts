import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

async function buildLayout(root: string) {
  const webPackage = resolve(root, 'apps/web/package.json');
  const monorepo = await access(webPackage).then(
    () => true,
    () => false,
  );
  return {
    dist: resolve(root, monorepo ? 'apps/web/dist' : 'dist'),
    sourcePaths: monorepo
      ? ['apps/web', 'packages/game-core', 'crates', 'package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json']
      : ['src', 'crates', 'vite.config.ts', 'package.json'],
  };
}

export async function productionSourceHash(root: string): Promise<string> {
  const { sourcePaths } = await buildLayout(root);
  const files = [
    ...new Set(
      execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', ...sourcePaths, 'pnpm-lock.yaml'], {
        cwd: root,
        encoding: 'utf8',
      })
        .trim()
        .split('\n'),
    ),
  ].sort();
  const hash = createHash('sha256');
  for (const file of files)
    hash
      .update(file)
      .update('\0')
      .update(
        createHash('sha256')
          .update(await readFile(resolve(root, file)))
          .digest('hex'),
      )
      .update('\0');
  return hash.digest('hex');
}
export async function expectedBuild(root: string, sourceSha: string) {
  const { dist } = await buildLayout(root);
  const stamp = JSON.parse(await readFile(resolve(dist, 'adoption-source.json'), 'utf8')) as {
    sourceSha: string;
    productionSourceHash: string;
  };
  if (stamp.sourceSha !== sourceSha || stamp.productionSourceHash !== (await productionSourceHash(root)))
    throw new Error(`Build/source binding mismatch: ${root}`);
  const files: Record<string, string> = {};
  for (const file of (await readdir(dist, { recursive: true })).sort()) {
    if (!/\.[a-z0-9]+$/i.test(file)) continue;
    if (!(await stat(resolve(dist, file))).isFile()) continue;
    files['/' + file] = createHash('sha256')
      .update(await readFile(resolve(dist, file)))
      .digest('hex');
  }
  return { ...stamp, files };
}
export async function assertServedBuild(origin: string, files: Record<string, string>) {
  for (const [path, hash] of Object.entries(files)) {
    const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(10000) });
    if (
      !response.ok ||
      createHash('sha256')
        .update(new Uint8Array(await response.arrayBuffer()))
        .digest('hex') !== hash
    )
      throw new Error(`Served build differs from frozen dist: ${origin}${path}`);
  }
}
