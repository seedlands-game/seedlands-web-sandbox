import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const lintSource = async (source: string, filePath: string) => {
  const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: 'eslint.config.mjs' });
  return eslint.lintText(source, { filePath });
};

describe.each([
  'packages/game-core/src/runtime/runtime-purity-probe.ts',
  'packages/game-core/src/physics/physics-purity-probe.ts',
])('%s 纯逻辑边界', (filePath) => {
  it('拒绝浏览器、Worker、渲染、client 和 app 依赖', async () => {
    const [result] = await lintSource(
      `
        import * as pc from 'playcanvas';
        import { World } from '../app/world-runtime';
        import { SnapshotInterpolator } from '../client/snapshot-interpolator';
        document.createElement('canvas');
        const worker = new Worker('authority-worker.ts');
        export const dependencies = [pc, World, SnapshotInterpolator, worker];
      `,
      filePath,
    );

    expect(result.messages.filter((message) => message.ruleId === 'seedlands/pure-runtime')).toHaveLength(5);
  });

  it('允许纯 world 数据、数值算法和类型', async () => {
    const [result] = await lintSource(
      `
        import { CHUNK_SIZE } from '../world/voxel';
        export const volume = CHUNK_SIZE ** 3;
      `,
      filePath,
    );

    expect(result.messages.filter((message) => message.ruleId === 'seedlands/pure-runtime')).toHaveLength(0);
  });

  it('类型字段 self 不等于宿主全局，但运行时访问仍被拒绝', async () => {
    const [result] = await lintSource(
      `
        export type Observation = { self: { position: number[] } };
        export interface Port { self(): void }
        self.postMessage('forbidden');
        export const computed = { [self.name]: 1 };
      `,
      filePath,
    );
    expect(result.messages.filter((message) => message.ruleId === 'seedlands/pure-runtime')).toHaveLength(2);
  });
});
