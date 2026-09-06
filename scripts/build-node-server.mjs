import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function buildNodeServer(outputDirectory = resolve(root, 'dist/node-server')) {
  const output = resolve(outputDirectory);
  const result = await build({
    absWorkingDir: root,
    entryPoints: {
      'node-server': 'src/node/server/node-server.ts',
      'node-authority-worker': 'src/node/server/node-authority-worker.ts',
      'node-persistence-worker': 'src/node/persistence/node-persistence-worker.ts',
      'node-compute-worker': 'src/node/compute/node-compute-worker.ts',
      'node-compute-child': 'src/node/compute/node-compute-child.ts',
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
    /(?:^|\/)(?:src\/(?:app|client)|node_modules\/(?:playcanvas|vite|svelte))(?:\/|$)/.test(name),
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
      .map(async (name) => ({ name, sha256: digest(await readFile(resolve(root, name))) })),
  );
  const manifest = {
    formatVersion: 1,
    sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
    lockSha256: digest(await readFile(resolve(root, 'pnpm-lock.yaml'))),
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
