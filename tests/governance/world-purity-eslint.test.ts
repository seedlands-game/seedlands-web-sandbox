import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const lintSource = async (source: string, filePath: string) => {
  const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: 'eslint.config.mjs' });
  return eslint.lintText(source, { filePath });
};

describe('src/world ESLint purity boundary', () => {
  it('rejects client, server and PlayCanvas imports from pure world code', async () => {
    const [result] = await lintSource(
      `
      import { GameServer } from '../server/game-server';
      import { GameClient } from '../client/game-client';
      import * as pc from 'playcanvas';
      export const runtime = [GameServer, GameClient, pc];
    `,
      'src/world/world-purity-probe.ts',
    );

    expect(result.messages.filter((message) => message.ruleId === 'seedlands/world-purity')).toHaveLength(3);
  });

  it('rejects DOM and Worker globals from pure world code', async () => {
    const [result] = await lintSource(
      `
      window.requestAnimationFrame(() => undefined);
      document.createElement('canvas');
      self.postMessage({ kind: 'world' });
      const worker = new Worker('world-worker.ts');
      export { worker };
    `,
      'src/world/world-purity-probe.ts',
    );

    expect(result.messages.filter((message) => message.ruleId === 'seedlands/world-purity')).toHaveLength(4);
  });

  it('allows deterministic world data and algorithms', async () => {
    const [result] = await lintSource(
      `
      import { CHUNK_SIZE } from './voxel';
      export const chunkVolume = CHUNK_SIZE ** 3;
    `,
      'src/world/world-purity-probe.ts',
    );

    expect(result.messages.filter((message) => message.ruleId === 'seedlands/world-purity')).toHaveLength(0);
  });

  it('rejects browser and rendering dependencies from pure server code', async () => {
    const [result] = await lintSource(
      `
      import * as pc from 'playcanvas';
      const worker = new Worker('world-worker.ts');
      document.createElement('canvas');
      export const runtime = [pc, worker];
    `,
      'src/server/server-purity-probe.ts',
    );

    expect(result.messages.filter((message) => message.ruleId === 'seedlands/server-purity')).toHaveLength(3);
  });
});
