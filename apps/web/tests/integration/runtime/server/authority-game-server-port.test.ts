import { testCorePlatform } from '../../../../../../packages/stdlib/tests/support/core-platform';
import { describe, expect, it } from 'vitest';
import { GameServer } from '../../../fixtures/classic/content';
import { computeFluidCandidate } from '../../../../../../packages/stdlib/src/server/fluid/fluid-transaction';
import { Voxel } from '../../../../../../packages/stdlib/src/world/voxel';

describe('GameServer Authority port', () => {
  it('只读已装载体素不会同步生成未知 Chunk', () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'authority-loaded-collision' });

    expect(server.peekLoadedVoxel(2_000, 20, 2_000)).toBeNull();
    expect(server.materializedChunkCount).toBe(0);
    server.getChunk(0, 0, 0);
    expect(server.peekLoadedVoxel(1, 20, 1)).toMatchObject({ chunkKey: '0,0,0', revision: 0 });
  });

  it('物理热路径只读取已装载流体且不会为未知坐标生成 Chunk', () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'authority-loaded-fluid' });

    expect(server.peekLoadedVoxel(2_000, 20, 2_000)).toBeNull();
    expect(server.materializedChunkCount).toBe(0);
    server.edit(0, 5, 0, Voxel.Water, 'test');
    expect(server.peekLoadedVoxel(0, 5, 0)).toMatchObject({ fluid: { level: 8 } });
  });

  it('规则时钟推进饥饿等可靠玩法截止时间但不调用旧实体重力或导航位移', () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'authority-rules-only' });
    server.spawnPlayer({ id: 'player-1', position: [0, 34, 0] });
    server.spawnWorldItem([4, 44, 0], { itemId: 'berry', count: 1 });

    server.advanceGameplayRules(120);

    expect(server.gameplayTime).toBe(120);
    expect(server.getPlayerState('player-1').hunger).toBe(19);
    expect(server.queryEntities({ type: 'world-item' })[0]?.position).toEqual([4, 44, 0]);
  });

  it('公开租赁/接纳/归还接口供保留流体 Worker 使用且不在请求时同步计算', () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'authority-fluid-port' });
    server.setFluidActiveChunks(['0,0,0']);
    server.edit(0, 5, 0, Voxel.Water, 'test');
    const work = server.requestFluidWork();

    expect(work).not.toBeNull();
    expect(server.requestFluidWork()).toBeNull();
    const candidate = computeFluidCandidate(work!);
    expect(server.commitFluidCandidate(candidate)).toMatchObject({ accepted: true });
    const second = server.requestFluidWork();
    if (second) expect(server.abortFluidWork(second.workId, 'test')).toBe(true);
  });
});
