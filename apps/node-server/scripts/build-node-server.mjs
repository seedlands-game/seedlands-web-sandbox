import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(import.meta.dirname, '..');
const workspaceRoot = resolve(packageRoot, '../..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

const gitValue = (args, fallback) => {
  try {
    return execFileSync('git', args, { cwd: workspaceRoot, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
};

export async function buildNodeServer(outputDirectory = resolve(packageRoot, 'dist')) {
  const output = resolve(outputDirectory);
  const result = await build({
    absWorkingDir: workspaceRoot,
    entryPoints: {
      'node-server': 'apps/node-server/src/node/server/node-server.ts',
      'node-authority-worker': 'apps/node-server/src/node/server/node-authority-worker.ts',
      'node-persistence-worker': 'apps/node-server/src/node/persistence/node-persistence-worker.ts',
      'node-compute-worker': 'apps/node-server/src/node/compute/node-compute-worker.ts',
      'node-compute-child': 'apps/node-server/src/node/compute/node-compute-child.ts',
    },
    outdir: output,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    bundle: true,
    splitting: false,
    metafile: true,
    write: false,
    sourcemap: false,
    logLevel: 'silent',
  });
  const forbidden = Object.keys(result.metafile.inputs).filter((name) =>
    /(?:^|\/)(?:apps\/web|node_modules\/(?:playcanvas|vite|svelte|tone))(?:\/|$)/.test(name),
  );
  if (forbidden.length) throw new Error(`Node 产物误含浏览器依赖：${forbidden.join(', ')}`);
  const files = [];
  for (const file of result.outputFiles) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents);
    files.push({
      name: file.path.slice(output.length + 1),
      bytes: file.contents.length,
      sha256: digest(file.contents),
    });
  }
  await writeFile(
    resolve(output, 'package.json'),
    JSON.stringify({ private: true, type: 'module', engines: { node: '>=22.12.0' } }, null, 2) + '\n',
  );
  const inputs = await Promise.all(
    Object.keys(result.metafile.inputs)
      .sort()
      .map(async (name) => ({ name, sha256: digest(await readFile(resolve(workspaceRoot, name))) })),
  );
  const manifest = {
    formatVersion: 1,
    sourceSha: gitValue(['rev-parse', 'HEAD'], 'isolated-workspace'),
    sourceDirty: Boolean(gitValue(['status', '--porcelain'], '')),
    lockSha256: digest(await readFile(resolve(workspaceRoot, 'pnpm-lock.yaml'))),
    sourceInputsSha256: digest(JSON.stringify(inputs)),
    runtime: 'node >=22.12.0',
    files,
  };
  await writeFile(resolve(output, 'artifact-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('此构建命令不接纳参数。');
  const manifest = await buildNodeServer();
  process.stdout.write(`Node 产物已生成：${manifest.files.length} 个 ESM 入口；source ${manifest.sourceSha}\n`);
}
