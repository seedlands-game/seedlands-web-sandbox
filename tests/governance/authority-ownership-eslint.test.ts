import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const lintSource = async (source: string, filePath: string) => {
  const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: 'eslint.config.mjs' });
  return eslint.lintText(source, { filePath });
};

describe.each(['src/app/authority-owner-probe.ts', 'src/client/authority-owner-probe.ts'])(
  '%s Authority所有权边界',
  (filePath) => {
    it('拒绝在浏览器主线程值导入或动态加载GameServer', async () => {
      const direct = await lintSource(
        `import { GameServer } from '../server/game-server'; export const server = new GameServer({seedText:'x'});`,
        filePath,
      );
      const dynamic = await lintSource(`export const server = import('../server/game-server');`, filePath);

      expect(
        direct[0].messages.filter((message) => message.ruleId === 'seedlands/authority-worker-owner'),
      ).toHaveLength(1);
      expect(
        dynamic[0].messages.filter((message) => message.ruleId === 'seedlands/authority-worker-owner'),
      ).toHaveLength(1);
    });

    it('允许只导入明确的server协议DTO', async () => {
      const [result] = await lintSource(
        `
          import type { WorldCommitResult } from '../server/game-server-types';
          export type Port = { worldRevision: number; commit: WorldCommitResult };
        `,
        filePath,
      );

      expect(result.messages.filter((message) => message.ruleId === 'seedlands/authority-worker-owner')).toHaveLength(
        0,
      );
    });

    it('拒绝借服务端命令执行器或具体GameServer参数重建浏览器权威路径', async () => {
      const commandExecutor = await lintSource(
        `
          import { ServerCommandExecutor } from '../server/commands/server-command-executor';
          export const execute = (server: unknown) => new ServerCommandExecutor(server);
        `,
        filePath,
      );
      const concreteParameter = await lintSource(
        `
          import type { GameServer } from '../server/game-server';
          export const read = (server: GameServer) => server.worldRevision;
        `,
        filePath,
      );

      expect(
        commandExecutor[0].messages.filter((message) => message.ruleId === 'seedlands/authority-worker-owner'),
      ).toHaveLength(1);
      expect(
        concreteParameter[0].messages.filter((message) => message.ruleId === 'seedlands/authority-worker-owner'),
      ).toHaveLength(1);
    });
  },
);
