import { describe, expect, it } from 'vitest';
import { GameServer } from '../../src/server/game-server';

describe('GameServer Authority port', () => {
  it('只读已装载体素不会同步生成未知 Chunk', () => {
    const server = new GameServer({ seedText: 'authority-loaded-collision' });

    expect(server.peekLoadedVoxel(2_000, 20, 2_000)).toBeNull();
    expect(server.materializedChunkCount).toBe(0);
    server.getChunk(0, 0, 0);
    expect(server.peekLoadedVoxel(1, 20, 1)).toMatchObject({ chunkKey: '0,0,0', revision: 0 });
  });

  it('规则时钟推进饥饿等可靠玩法截止时间但不调用旧实体重力或导航位移', () => {
    const server = new GameServer({ seedText: 'authority-rules-only' });
    server.spawnPlayer({ id: 'player-1', position: [0, 34, 0] });
    server.spawnWorldItem([4, 44, 0], { itemId: 'berry', count: 1 });

    server.advanceGameplayRules(120);

    expect(server.gameplayTime).toBe(120);
    expect(server.getPlayerState('player-1').hunger).toBe(19);
    expect(server.queryEntities({ type: 'world-item' })[0]?.position).toEqual([4, 44, 0]);
  });
});
