import { describe, expect, it, vi } from 'vitest';
import { runWorldComputeTask } from '../../src/worker/world-compute-task';
import { makeChunk } from '../../src/world/chunk-generation';

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
      { makeChunk: generate },
    );
    expect(generate).toHaveBeenCalledExactlyOnceWith(1, 0, 0, 0, [], 3);
    expect(result).toEqual(await runWorldComputeTask(task));
    generate.mockClear();
    await expect(
      runWorldComputeTask(
        task,
        () => true,
        async () => undefined,
        { makeChunk: generate },
      ),
    ).rejects.toThrow(/cancelled/i);
    expect(generate).not.toHaveBeenCalled();
  });
});
