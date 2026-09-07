import { testCorePlatform } from '../support/core-platform';
import { describe, expect, it } from 'vitest';
import { AuthorityRuntime } from '../../packages/game-core/src/server/authority/authority-runtime';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import { MemoryGamePersistence } from '../../packages/game-core/src/server/persistence/memory-game-persistence';
import { Voxel } from '../../packages/game-core/src/world/voxel';

const options = (persistence: MemoryGamePersistence, epoch: string) => ({
  platform: testCorePlatform,
  epoch,
  seedText: 'checkpoint-restore',
  persistence,
  initialWorldTime: 9,
  startTimeMs: 0,
  initialPlayerBodyPosition: [0.5, 33, 0.5] as [number, number, number],
});

describe('冻结检查点跨会话恢复', () => {
  it('重载保留持久提交序号，立即保存不会回退', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const first = await AuthorityRuntime.create(options(persistence, 'first'));
    first.advanceSession(10_000);
    const saved = await first.save();
    expect(saved.commitSequence).toBeGreaterThanOrEqual(600);

    const second = await AuthorityRuntime.create(options(persistence, 'second'));
    expect(second.ready().snapshot.commitSequence).toBe(saved.commitSequence);
    expect((await second.save()).commitSequence).toBe(saved.commitSequence);
    second.advanceSession(100);
    expect((await second.save()).commitSequence).toBeGreaterThan(saved.commitSequence);
  }, 15_000);

  it('冻结的世界修订号在尚未加载任何Chunk时就恢复', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const original = new GameServer({ platform: testCorePlatform, seedText: 'checkpoint-world-revision', persistence });
    original.spawnPlayer({ position: [0.5, 33, 0.5] });
    original.edit(0, 20, 0, Voxel.Water);
    await original.save(42);
    const restored = new GameServer({ platform: testCorePlatform, seedText: 'checkpoint-world-revision', persistence });
    await restored.restore();
    expect(restored.materializedChunkCount).toBe(0);
    expect(restored.worldRevision).toBe(original.worldRevision);
    expect(restored.worldRevision).toBeGreaterThan(0);
  });

  it('非法检查点拒绝恢复，不覆盖现有持久数据', async () => {
    class InvalidCheckpointPersistence extends MemoryGamePersistence {
      constructor() {
        super({ clone: testCorePlatform.clone });
      }

      override loadGameCheckpoint() {
        return { commitSequence: -1, worldRevision: 0 };
      }
    }
    const persistence = new InvalidCheckpointPersistence();
    await expect(AuthorityRuntime.create(options(persistence, 'invalid'))).rejects.toThrow(/检查点|checkpoint/i);
    expect(persistence.loadGameplaySnapshot()).toBeNull();
    expect(persistence.writes).toEqual([]);
  });
});
