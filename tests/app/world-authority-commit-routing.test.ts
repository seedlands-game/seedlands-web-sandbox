import { describe, expect, it, vi } from 'vitest';
import { World } from '../../src/app/world-runtime';
import type { WorldCommitResult } from '../../src/server/game-server-types';

describe('World 权威提交单一发布点', () => {
  it('编辑Promise只返回结果，不再次消费已由Authority消息发布的提交', async () => {
    const result = { committed: true } as WorldCommitResult;
    const editWorld = vi.fn(async () => result);
    const consumeServerCommit = vi.fn();
    const receiver = { authority: { editWorld }, consumeServerCommit } as unknown as World;

    await expect(World.prototype.edit.call(receiver, 1, 2, 3, 0)).resolves.toBe(result);
    await expect(
      World.prototype.editBatch.call(receiver, {
        actorId: 'batch-test',
        edits: [{ x: 4, y: 5, z: 6, value: 3 }],
      }),
    ).resolves.toBe(result);
    await expect(World.prototype.restoreLegacyChanges.call(receiver, [[7, 8, 9, 2]])).resolves.toBe(result);

    expect(editWorld).toHaveBeenCalledTimes(3);
    expect(consumeServerCommit).not.toHaveBeenCalled();
  });
});
