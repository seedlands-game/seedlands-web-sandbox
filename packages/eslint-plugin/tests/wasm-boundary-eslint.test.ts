import { describe, expect, it } from 'vitest';
import { createEslint } from './eslint';

const violations = async (source: string, filePath: string, rule: string) => {
  const eslint = createEslint();
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter((message) => message.ruleId === `seedlands/${rule}`);
};

describe('Wasm 加载与纯内核边界', () => {
  it('world 不得依赖 Wasm 适配器或直接加载模块', async () => {
    expect(
      await violations(
        "import { KernelMemory } from '../compute/kernel-memory'; export { KernelMemory };",
        'packages/stdlib/src/world/probe.ts',
        'world-purity',
      ),
    ).toHaveLength(1);
    expect(
      await violations(
        "export const bytes = fetch('/kernel.wasm');",
        'packages/stdlib/src/world/probe.ts',
        'world-purity',
      ),
    ).toHaveLength(1);
  });

  it('compute 不得持有 Worker、网络、渲染或权威服务', async () => {
    for (const source of [
      "import { GameServer } from '../server/game-server'; export { GameServer };",
      "import * as pc from 'playcanvas'; export { pc };",
      "export const worker = new Worker('kernel');",
      "export const bytes = fetch('/kernel.wasm');",
    ])
      expect(await violations(source, 'apps/web/src/compute/probe.ts', 'compute-purity')).toHaveLength(1);
  });

  it('允许纯 ABI 操作和 world 逻辑，加载留在 Worker 适配层', async () => {
    expect(
      await violations(
        "import { Voxel } from '../world/voxel'; export const classify = (v: number) => v !== Voxel.Air;",
        'apps/web/src/compute/probe.ts',
        'compute-purity',
      ),
    ).toHaveLength(0);
    expect(
      await violations(
        'export const memory = new WebAssembly.Memory({ initial: 1 });',
        'apps/web/src/compute/probe.ts',
        'compute-purity',
      ),
    ).toHaveLength(0);
    expect(
      await violations("export const bytes = fetch('/kernel.wasm');", 'apps/web/src/worker/probe.ts', 'compute-purity'),
    ).toHaveLength(0);
  });
});
