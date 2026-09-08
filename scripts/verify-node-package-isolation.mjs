import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const workspaceRoot = resolve(import.meta.dirname, '..');
const evidenceRoot = '/tmp/seedlands-monorepo';
const isolatedRoot = resolve(evidenceRoot, 'node-isolation');
const runtimeRoot = resolve(evidenceRoot, 'node-runtime-only');

const run = (command, args, cwd = isolatedRoot) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });

const copyWorkspacePath = async (path) => {
  await cp(resolve(workspaceRoot, path), resolve(isolatedRoot, path), {
    recursive: true,
    filter: (source) => !['node_modules', 'dist'].includes(source.split('/').at(-1)),
  });
};

await rm(isolatedRoot, { recursive: true, force: true });
await rm(runtimeRoot, { recursive: true, force: true });
await mkdir(isolatedRoot, { recursive: true });
for (const path of [
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'tsconfig.base.json',
  'packages/game-core',
  'apps/node-server',
])
  await copyWorkspacePath(path);

const rootManifest = JSON.parse(await readFile(resolve(workspaceRoot, 'package.json'), 'utf8'));
await writeFile(
  resolve(isolatedRoot, 'package.json'),
  JSON.stringify(
    {
      name: 'seedlands-node-isolation',
      private: true,
      version: rootManifest.version,
      packageManager: rootManifest.packageManager,
    },
    null,
    2,
  ) + '\n',
);

const installOutput = run('pnpm', ['install', '--no-frozen-lockfile']);
const coreTypecheckOutput = run('pnpm', ['--filter', '@seedlands/game-core', 'typecheck']);
const nodeBuildOutput = run('pnpm', ['--filter', '@seedlands/node-server', 'build']);

const installedPackages = await readdir(resolve(isolatedRoot, 'node_modules/.pnpm'));
const forbiddenProducts = installedPackages.filter((name) => /^(?:playcanvas|svelte|tone)(?:@|$)/.test(name));
if (forbiddenProducts.length) throw new Error(`隔离安装包含 Web 产品依赖：${forbiddenProducts.join(', ')}`);
const testTooling = installedPackages.filter((name) => /^(?:vite|vitest)(?:@|$)/.test(name)).sort();
const isolatedNodeModules = await realpath(resolve(isolatedRoot, 'node_modules'));
const workspaceNodeModules = await realpath(resolve(workspaceRoot, 'node_modules'));
const webSourcePresent = existsSync(resolve(isolatedRoot, 'apps/web'));
if (webSourcePresent || isolatedNodeModules === workspaceNodeModules)
  throw new Error('隔离验证误用了 Web 源码或根 node_modules。');

await cp(resolve(isolatedRoot, 'apps/node-server/dist'), runtimeRoot, { recursive: true });
const helpOutput = run(process.execPath, ['node-server.js', '--help'], runtimeRoot);
if (!helpOutput.includes('Seedlands Node 世界宿主')) throw new Error('隔离 Node 产物未输出预期帮助。');

const report = {
  formatVersion: 1,
  node: process.version,
  isolatedRoot,
  webSourcePresent,
  rootNodeModulesReused: isolatedNodeModules === workspaceNodeModules,
  forbiddenWebProductDependencies: forbiddenProducts,
  sharedTestTooling: testTooling,
  commands: {
    install: installOutput.trim().split('\n').at(-1),
    coreTypecheck: coreTypecheckOutput.trim().split('\n').at(-1),
    nodeBuild: nodeBuildOutput.trim().split('\n').at(-1),
    runtime: helpOutput.trim().split('\n')[0],
  },
};
await writeFile(resolve(evidenceRoot, 'node-isolation-report.json'), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
