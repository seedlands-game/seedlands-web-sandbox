import { describe, expect, it } from 'vitest';
import { createEslint } from './eslint';

const lint = async (source: string, filePath: string) => {
  const eslint = createEslint();
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter((message) => message.ruleId === 'seedlands/node-platform-boundary');
};

describe('退役后的 Node 平台依赖边界', () => {
  it.each([
    'packages/kernel/src/spatial',
    'packages/stdlib/src/world',
    'packages/stdlib/src/physics',
    'packages/stdlib/src/runtime',
    'packages/stdlib/src/server',
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
      'packages/stdlib/src/server/node-boundary-probe.ts',
    );
    expect(messages).toHaveLength(2);
  });
});
