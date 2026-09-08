import { testCorePlatform } from '../support/core-platform';
import { describe, expect, it } from 'vitest';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import type { GameplayPersistence } from '../../packages/game-core/src/server/persistence/gameplay-persistence';
import type {
  ChunkPersistence,
  ChunkSnapshot,
} from '../../packages/game-core/src/server/persistence/chunk-persistence';
import type { FrozenGameSaveSnapshot } from '../../packages/game-core/src/server/persistence/game-save-snapshot';
import { MemoryGamePersistence } from '../../packages/game-core/src/server/persistence/memory-game-persistence';
import { ItemIds } from '../../packages/game-core/src/server/gameplay/item-registry';
import { Voxel, voxelIndex } from '../../packages/game-core/src/world/voxel';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

class ControlledGamePersistence extends MemoryGamePersistence {
  constructor() {
    super({ clone: testCorePlatform.clone });
  }

  readonly started = deferred();
  readonly release = deferred();

  override async saveFrozenSnapshot(snapshot: FrozenGameSaveSnapshot): Promise<void> {
    this.started.resolve();
    await this.release.promise;
    super.saveFrozenSnapshot(snapshot);
  }
}

const spawnState = (server: GameServer) => {
  server.spawnPlayer({ id: 'player', position: [0.5, 34, 0.5] });
  server.giveItem('player', { itemId: ItemIds.Berry, count: 1 });
  server.edit(0, 20, 0, Voxel.Water);
};

describe('GameServer 一致冻结保存', () => {
  it('在异步落盘期间继续推进时，重载只读取同一冻结时刻并保留后续 dirty', async () => {
    const persistence = new ControlledGamePersistence();
    const server = new GameServer({ platform: testCorePlatform, seedText: 'frozen-consistency', persistence });
    spawnState(server);
    const frozenGameplayRevision = server.gameplayRevision;
    const frozen = server.freezeSaveSnapshot(17);
    expect(structuredClone(frozen)).toEqual(frozen);
    expect(frozen).toMatchObject({
      version: 1,
      commitSequence: 17,
      worldRevision: 1,
      physicsSchema: { version: 1, bodyRegistryVersion: 1 },
      fluidSchema: { version: 1, encoding: 'chunk-level-source-byte' },
      chunks: [{ revision: 1, fluidVersion: 1 }],
    });
    const saving = server.saveFrozen(frozen);
    await persistence.started.promise;

    expect(server.persistedGameplayRevision).toBeLessThan(frozenGameplayRevision);
    expect(server.getChunk(0, 0, 0).persistedRevision).toBe(0);
    server.updateEntity('player', { position: [3.5, 35, 0.5], physicsVelocity: [1, -2, 0] });
    server.giveItem('player', { itemId: ItemIds.Berry, count: 1 });
    server.edit(0, 20, 0, Voxel.Sand);

    persistence.release.resolve();
    await expect(saving).resolves.toEqual({ savedChunks: ['0,0,0'], gameplaySaved: true, commitSequence: 17 });
    expect(server.getChunk(0, 0, 0)).toMatchObject({ revision: 2, persistedRevision: 1, dirty: true });
    expect(server.persistedGameplayRevision).toBe(frozenGameplayRevision);
    expect(server.gameplayRevision).toBeGreaterThan(frozenGameplayRevision);

    const reloaded = new GameServer({ platform: testCorePlatform, seedText: 'frozen-consistency', persistence });
    await reloaded.restore();
    expect(reloaded.getVoxel(0, 20, 0)).toBe(Voxel.Water);
    expect(reloaded.getEntity('player')?.position).toEqual([0.5, 34, 0.5]);
    expect(reloaded.getInventory('player').slots[0]).toEqual({ itemId: ItemIds.Berry, count: 1 });
  });

  it('冻结数据与之后的权威 voxel、fluid 和 Gameplay 修改不共享引用', () => {
    const server = new GameServer({
      platform: testCorePlatform,
      seedText: 'frozen-isolation',
      persistence: new MemoryGamePersistence({ clone: testCorePlatform.clone }),
    });
    spawnState(server);
    const frozen = server.freezeSaveSnapshot(3);
    const chunk = frozen.chunks[0];
    const index = voxelIndex(0, 20, 0);
    const frozenPlayer = frozen.gameplay.entities.find((entity) => entity.id === 'player');

    server.edit(0, 20, 0, Voxel.Air);
    server.updateEntity('player', { position: [9, 40, 9] });

    expect(chunk.voxels[index]).toBe(Voxel.Water);
    expect(chunk.fluid?.[index]).toBeGreaterThan(0);
    expect(frozenPlayer?.position).toEqual([0.5, 34, 0.5]);
  });

  it('调用方修改公开 token 也不能改变内部冻结 checkpoint', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const server = new GameServer({ platform: testCorePlatform, seedText: 'frozen-token-isolation', persistence });
    spawnState(server);
    const frozen = server.freezeSaveSnapshot(4);
    const mutable = frozen as unknown as {
      gameplay: { entities: Array<{ position: [number, number, number] }> };
      chunks: ChunkSnapshot[];
    };
    mutable.gameplay.entities[0].position[1] = 999;
    mutable.chunks[0].voxels[voxelIndex(0, 20, 0)] = Voxel.Sand;

    await server.saveFrozen(frozen);
    const reloaded = new GameServer({ platform: testCorePlatform, seedText: 'frozen-token-isolation', persistence });
    await reloaded.restore();
    expect(reloaded.getEntity('player')?.position).toEqual([0.5, 34, 0.5]);
    expect(reloaded.getVoxel(0, 20, 0)).toBe(Voxel.Water);
  });

  it('失败不推进 ACK 或覆盖旧 checkpoint，重试后整体更新', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const server = new GameServer({ platform: testCorePlatform, seedText: 'frozen-failure', persistence });
    spawnState(server);
    await server.save(1);
    const persistedGameplayRevision = server.persistedGameplayRevision;

    server.edit(0, 20, 0, Voxel.Sand);
    server.giveItem('player', { itemId: ItemIds.Berry, count: 1 });
    persistence.failNextFrozenSave(new Error('simulated atomic failure'));
    await expect(server.save(2)).rejects.toThrow('simulated atomic failure');
    expect(server.getChunk(0, 0, 0)).toMatchObject({ revision: 2, persistedRevision: 1, dirty: true });
    expect(server.persistedGameplayRevision).toBe(persistedGameplayRevision);

    const oldCheckpoint = new GameServer({ platform: testCorePlatform, seedText: 'frozen-failure', persistence });
    await oldCheckpoint.restore();
    expect(oldCheckpoint.getVoxel(0, 20, 0)).toBe(Voxel.Water);
    expect(oldCheckpoint.getInventory('player').slots[0]?.count).toBe(1);

    await expect(server.save(3)).resolves.toMatchObject({ gameplaySaved: true, commitSequence: 3 });
    const newCheckpoint = new GameServer({ platform: testCorePlatform, seedText: 'frozen-failure', persistence });
    await newCheckpoint.restore();
    expect(newCheckpoint.getVoxel(0, 20, 0)).toBe(Voxel.Sand);
    expect(newCheckpoint.getInventory('player').slots[0]?.count).toBe(2);
  });

  it('Gameplay 持久化缺少原子入口时，在任何旧写入前拒绝', async () => {
    let chunkWrites = 0;
    let gameplayWrites = 0;
    const persistence: GameplayPersistence & ChunkPersistence = {
      loadSnapshot: () => null,
      saveSnapshots: () => {
        chunkWrites += 1;
      },
      loadGameplaySnapshot: () => null,
      saveGameplaySnapshot: () => {
        gameplayWrites += 1;
      },
    };
    const server = new GameServer({ platform: testCorePlatform, seedText: 'atomic-port-required', persistence });
    spawnState(server);

    await expect(server.save(1)).rejects.toThrow(/atomic|frozen/i);
    expect({ chunkWrites, gameplayWrites }).toEqual({ chunkWrites: 0, gameplayWrites: 0 });
    expect(server.getChunk(0, 0, 0).dirty).toBe(true);
  });

  it('未配置持久化时不产生虚假 ACK', async () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'no-persistence-ack' });
    server.edit(0, 20, 0, Voxel.Wood);

    await expect(server.save(1)).resolves.toEqual({ savedChunks: [], gameplaySaved: false, commitSequence: 1 });
    expect(server.getChunk(0, 0, 0)).toMatchObject({ revision: 1, persistedRevision: 0, dirty: true });
  });

  it('持久检查点跨会话保持排序，不能用零序号覆盖旧保存', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const first = new GameServer({ platform: testCorePlatform, seedText: 'new-session-sequence', persistence });
    spawnState(first);
    await first.save(17);

    const second = new GameServer({ platform: testCorePlatform, seedText: 'new-session-sequence', persistence });
    await second.restore();
    second.giveItem('player', { itemId: ItemIds.Berry, count: 1 });
    expect(second.restoredCommitSequence).toBe(17);
    await expect(second.save(0)).rejects.toThrow(/newer.*checkpoint/i);
    await expect(second.save(18)).resolves.toMatchObject({ gameplaySaved: true, commitSequence: 18 });
  });
});
