import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const exists = async (path: string) =>
  access(join(root, path)).then(
    () => true,
    () => false,
  );

describe('Node 产品退役合同', () => {
  it('从活跃 workspace、根任务和 CI 门禁移除 Node 产品', async () => {
    const [manifestText, workspace, tsconfig, ci] = await Promise.all([
      readFile(join(root, 'package.json'), 'utf8'),
      readFile(join(root, 'pnpm-workspace.yaml'), 'utf8'),
      readFile(join(root, 'tsconfig.json'), 'utf8'),
      readFile(join(root, '.github/workflows/ci.yml'), 'utf8'),
    ]);
    const manifest = JSON.parse(manifestText) as { scripts?: Record<string, string> };

    expect(await exists('apps/node-server/package.json')).toBe(false);
    expect(await exists('packages/game-core/src/server/dedicated/dedicated-server-host.ts')).toBe(false);
    expect(await exists('packages/game-core/src/server/compute/dedicated-compute-contract.ts')).toBe(false);
    expect(await exists('scripts/build-node-server.mjs')).toBe(false);
    expect(await exists('scripts/verify-node-package-isolation.mjs')).toBe(false);
    expect(await exists('scripts/verify-web-node-playable-dist.mjs')).toBe(false);
    expect(workspace).not.toContain('node-server');
    expect(tsconfig).not.toContain('apps/node-server');
    expect(JSON.stringify(manifest.scripts)).not.toMatch(/node-server|build:server|server:dedicated|web-node-playable/);
    expect(ci).not.toMatch(/node-server|web-node-playable|active-node/i);
  });

  it('Headless CLI 使用 scripts 内的平台端口且浏览器只保留本地产品入口', async () => {
    const [headless, game, shell, startScreen] = await Promise.all([
      readFile(join(root, 'scripts/server-headless.mjs'), 'utf8'),
      readFile(join(root, 'apps/web/src/app/game.ts'), 'utf8'),
      readFile(join(root, 'apps/web/src/client/shell/shell-controller.ts'), 'utf8'),
      readFile(join(root, 'apps/web/src/app/ui/start-screen.svelte'), 'utf8'),
    ]);

    expect(await exists('scripts/headless/node-core-platform.ts')).toBe(true);
    expect(headless).toContain('/scripts/headless/node-core-platform.ts');
    expect(headless).not.toContain('/apps/node-server/');
    expect(`${game}\n${shell}\n${startScreen}`).not.toMatch(/RemoteAuthority|startRemote|connectRemote|本机 Node/);
  });
});
