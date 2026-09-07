import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

type PackageManifest = {
  name?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

const root = process.cwd();

const readJson = async <Value>(path: string): Promise<Value> =>
  JSON.parse(await readFile(join(root, path), 'utf8')) as Value;

describe('三包 workspace 边界', () => {
  it('声明 Web、Node 和 game-core 三个 workspace 包', async () => {
    const workspace = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toContain('apps/*');
    expect(workspace).toContain('packages/*');

    const [web, nodeServer, gameCore] = await Promise.all([
      readJson<PackageManifest>('apps/web/package.json'),
      readJson<PackageManifest>('apps/node-server/package.json'),
      readJson<PackageManifest>('packages/game-core/package.json'),
    ]);

    expect(web.name).toBe('@seedlands/web');
    expect(nodeServer.name).toBe('@seedlands/node-server');
    expect(gameCore.name).toBe('@seedlands/game-core');
  });

  it('两端只经声明依赖消费 game-core，且 core 提供明确导出', async () => {
    const [web, nodeServer, gameCore] = await Promise.all([
      readJson<PackageManifest>('apps/web/package.json'),
      readJson<PackageManifest>('apps/node-server/package.json'),
      readJson<PackageManifest>('packages/game-core/package.json'),
    ]);

    expect(web.dependencies?.['@seedlands/game-core']).toBe('workspace:*');
    expect(nodeServer.dependencies?.['@seedlands/game-core']).toBe('workspace:*');
    expect(gameCore.dependencies?.['@seedlands/web']).toBeUndefined();
    expect(gameCore.dependencies?.['@seedlands/node-server']).toBeUndefined();
    expect(web.dependencies?.['@seedlands/node-server']).toBeUndefined();
    expect(nodeServer.dependencies?.['@seedlands/web']).toBeUndefined();
    expect(gameCore.exports).toBeTruthy();
  });

  it('core 类型环境不包含 DOM、WebWorker 或 Node ambient types', async () => {
    const config = await readJson<{
      compilerOptions?: { lib?: string[]; types?: string[] };
    }>('packages/game-core/tsconfig.json');
    const libraries = config.compilerOptions?.lib ?? [];
    const types = config.compilerOptions?.types ?? [];

    expect(libraries).not.toContain('DOM');
    expect(libraries).not.toContain('WebWorker');
    expect(types).not.toContain('node');
  });

  it('各包提供独立类型检查、构建和测试入口', async () => {
    for (const packagePath of [
      'apps/web/package.json',
      'apps/node-server/package.json',
      'packages/game-core/package.json',
    ]) {
      const manifest = await readJson<PackageManifest>(packagePath);
      expect(manifest.scripts?.typecheck, packagePath).toBeTruthy();
      expect(manifest.scripts?.build, packagePath).toBeTruthy();
      expect(manifest.scripts?.test, packagePath).toBeTruthy();
    }
  });
});
