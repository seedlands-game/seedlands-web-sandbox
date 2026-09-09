import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ESLint } from 'eslint';
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

const lintPackageBoundary = async (source: string, filePath: string) => {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: 'eslint.config.mjs' });
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter((message) => message.ruleId === 'seedlands/package-boundary');
};

describe('Web 与 game-core workspace 边界', () => {
  it('声明 Web 和 game-core 两个活跃 workspace 包', async () => {
    const workspace = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toContain('apps/*');
    expect(workspace).toContain('packages/*');

    const [web, gameCore] = await Promise.all([
      readJson<PackageManifest>('apps/web/package.json'),
      readJson<PackageManifest>('packages/game-core/package.json'),
    ]);

    expect(web.name).toBe('@seedlands/web');
    expect(gameCore.name).toBe('@seedlands/game-core');
  });

  it('Web 只经声明依赖消费 game-core，且 core 提供明确导出', async () => {
    const [web, gameCore] = await Promise.all([
      readJson<PackageManifest>('apps/web/package.json'),
      readJson<PackageManifest>('packages/game-core/package.json'),
    ]);

    expect(web.dependencies?.['@seedlands/game-core']).toBe('workspace:*');
    expect(gameCore.dependencies?.['@seedlands/web']).toBeUndefined();
    expect(gameCore.dependencies?.['@seedlands/node-server']).toBeUndefined();
    expect(web.dependencies?.['@seedlands/node-server']).toBeUndefined();
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
    for (const packagePath of ['apps/web/package.json', 'packages/game-core/package.json']) {
      const manifest = await readJson<PackageManifest>(packagePath);
      expect(manifest.scripts?.typecheck, packagePath).toBeTruthy();
      expect(manifest.scripts?.build, packagePath).toBeTruthy();
      expect(manifest.scripts?.test, packagePath).toBeTruthy();
    }
  });

  it.each([['apps/web/src/client/package-probe.ts', '../../../../packages/game-core/src/world/voxel']])(
    '拒绝 %s 用相对文件路径绕过 core exports',
    async (filePath, dependency) => {
      expect(await lintPackageBoundary(`import '${dependency}';`, filePath)).toHaveLength(1);
    },
  );

  it('拒绝 core 反向依赖 Web，并拒绝 Web/core 导入已退役 Node 产品', async () => {
    const coreMessages = await lintPackageBoundary(
      `import '../../../../apps/web/src/app/game'; import '@seedlands/node-server/runtime';`,
      'packages/game-core/src/server/package-probe.ts',
    );
    const webMessages = await lintPackageBoundary(
      `import '../../../../apps/node-server/src/node/server/node-server'; import '@seedlands/node-server/runtime';`,
      'apps/web/src/client/package-probe.ts',
    );
    expect(coreMessages).toHaveLength(2);
    expect(webMessages).toHaveLength(2);
  });

  it('拒绝未声明 workspace、外部产品依赖和未导出的 core 子路径', async () => {
    const webMessages = await lintPackageBoundary(
      `import '@seedlands/unknown/runtime'; import 'undici'; import '@seedlands/game-core/internal/private';`,
      'apps/web/src/client/package-probe.ts',
    );
    expect(webMessages).toHaveLength(3);
  });

  it('允许包内相对导入、声明的产品依赖和 core subpath exports', async () => {
    expect(
      await lintPackageBoundary(
        `import './browser-authority-client-contract'; import 'playcanvas'; import '@seedlands/game-core/server/game-server';`,
        'apps/web/src/client/authority/package-probe.ts',
      ),
    ).toEqual([]);
  });
});
