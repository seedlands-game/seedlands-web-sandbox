import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const lint = async (source: string, filePath: string) => {
  const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: 'eslint.config.mjs' });
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter((message) => message.ruleId === 'seedlands/node-platform-boundary');
};

describe('Node 平台依赖边界', () => {
  it.each(['world', 'physics', 'runtime', 'server', 'client/authority', 'app/world', 'worker'])(
    '拒绝 %s 导入 Node builtin 或平台实现',
    async (directory) => {
      const messages = await lint(
        `import { readFile } from 'node:fs/promises';
         import { fork } from 'child_process';
         export { start } from '../../node/server/server-entry';
         export const dependencies = [readFile, fork];`,
        `src/${directory}/node-boundary-probe.ts`,
      );
      expect(messages).toHaveLength(3);
    },
  );

  it('同样拒绝动态导入与 require 绕过', async () => {
    const messages = await lint(
      `export const load = () => import('node:worker_threads');
       export const fs = require('fs');`,
      'src/server/dedicated/node-boundary-probe.ts',
    );
    expect(messages).toHaveLength(2);
  });

  it('允许 Node adapter 组合纯服务与平台依赖', async () => {
    expect(
      await lint(
        `import { readFile } from 'node:fs/promises';
         import { DedicatedServerHost } from '../../server/dedicated/dedicated-server-host';
         export const dependencies = [readFile, DedicatedServerHost];`,
        'src/node/server/node-boundary-probe.ts',
      ),
    ).toEqual([]);
  });

  it('拒绝 Node adapter 反向使用 app、client、DOM 或 Worker global', async () => {
    const messages = await lint(
      `import { Game } from '../../app/game';
       import { Client } from '../../client/authority/browser-authority-client';
       export const dependencies = [Game, Client, document, self];`,
      'src/node/server/node-boundary-probe.ts',
    );
    expect(messages).toHaveLength(4);
  });
});
