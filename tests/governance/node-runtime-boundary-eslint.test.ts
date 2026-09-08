import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const lint = async (source: string, filePath: string) => {
  const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: 'eslint.config.mjs' });
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter((message) => message.ruleId === 'seedlands/node-platform-boundary');
};

describe('Node 平台依赖边界', () => {
  it.each([
    'packages/game-core/src/world',
    'packages/game-core/src/physics',
    'packages/game-core/src/runtime',
    'packages/game-core/src/server',
    'apps/web/src/client/authority',
    'apps/web/src/app/world',
    'apps/web/src/worker',
  ])('拒绝 %s 导入 Node builtin 或平台实现', async (directory) => {
    const messages = await lint(
      `import { readFile } from 'node:fs/promises';
         import { fork } from 'child_process';
         export { start } from '../../node/server/server-entry';
         export const dependencies = [readFile, fork];`,
      `${directory}/node-boundary-probe.ts`,
    );
    expect(messages).toHaveLength(3);
  });

  it('同样拒绝动态导入与 require 绕过', async () => {
    const messages = await lint(
      `export const load = () => import('node:worker_threads');
       export const fs = require('fs');`,
      'packages/game-core/src/server/dedicated/node-boundary-probe.ts',
    );
    expect(messages).toHaveLength(2);
  });

  it('允许 Node adapter 组合纯服务与平台依赖', async () => {
    expect(
      await lint(
        `import { readFile } from 'node:fs/promises';
         import { DedicatedServerHost } from '../../server/dedicated/dedicated-server-host';
         export const dependencies = [readFile, DedicatedServerHost];`,
        'apps/node-server/src/node/server/node-boundary-probe.ts',
      ),
    ).toEqual([]);
  });

  it('拒绝 Node adapter 反向使用 app、client、DOM 或 Worker global', async () => {
    const messages = await lint(
      `import { Game } from '../../app/game';
       import { Client } from '../../client/authority/browser-authority-client';
       export const dependencies = [Game, Client, document, self];`,
      'apps/node-server/src/node/server/node-boundary-probe.ts',
    );
    expect(messages).toHaveLength(4);
  });
});
