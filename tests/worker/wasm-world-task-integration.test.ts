import { testCorePlatform } from '../support/core-platform';
import { describe, expect, it, vi } from 'vitest';
import { runWorldComputeTask } from '../../packages/game-core/src/compute/world-compute-task';
import { makeChunk } from '../../packages/game-core/src/world/chunk-generation';

describe('General Worker 可替换的纯计算入口', () => {
  it('保持规范生成身份、取消点与独立内核接线', async () => {
    const generate = vi.fn(makeChunk);
    const task = {
      kind: 'generate-canonical' as const,
      seed: 1,
      generatorVersion: 3,
      key: '0,0,0',
      cx: 0,
      cy: 0,
      cz: 0,
    };
    const result = await runWorldComputeTask(
      task,
      () => false,
      async () => undefined,
      { makeChunk: generate, now: testCorePlatform.now },
    );
    expect(generate).toHaveBeenCalledExactlyOnceWith(1, 0, 0, 0, [], 3);
    expect(result).toEqual(
      await runWorldComputeTask(task, () => false, testCorePlatform.yieldTurn, { now: testCorePlatform.now }),
    );
    generate.mockClear();
    await expect(
      runWorldComputeTask(
        task,
        () => true,
        async () => undefined,
        { makeChunk: generate, now: testCorePlatform.now },
      ),
    ).rejects.toThrow(/cancelled/i);
    expect(generate).not.toHaveBeenCalled();
  });
});
