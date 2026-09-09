import { testCorePlatform } from '../support/core-platform';
import { describe, expect, it, vi } from 'vitest';
import { AuthorityRuntime } from '../../packages/game-core/src/server/authority/authority-runtime';
import { applyActorAuthorityAction } from '../../packages/game-core/src/server/gameplay/actor-authority-gameplay';
import { GameplayRuntime } from '../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { ItemIds } from '../../packages/game-core/src/server/gameplay/item-registry';
import { Voxel, chunkKey } from '../../packages/game-core/src/world/voxel';

describe('玩法事务只读取已加载权威Chunk', () => {
  it('未知目标等待General异步准备，不同步生成、不提前扣库存，并在等待期间继续物理步', async () => {
    const requested: string[] = [];
    const runtime = await AuthorityRuntime.create({
      platform: testCorePlatform,
      epoch: 'unknown-gameplay:1',
      seedText: 'unknown-gameplay',
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
      onUnknownChunk: (key) => {
        requested.push(key);
      },
    });
    const ready = runtime.ready();
    runtime.setPlayerPosition([2_048.5, 80, 0.5]);
    runtime.server.giveItem(ready.playerId, { itemId: ItemIds.DirtBlock, count: 2 });
    runtime.server.selectHotbarSlot(ready.playerId, 0);
    const beforeInventory = runtime.server.getInventory(ready.playerId);

    const placing = runtime.performAction({ type: 'place', position: [2_049, 80, 0] });
    await vi.waitFor(() => expect(requested).toContain('64,2,0'));
    expect(runtime.server.getInventory(ready.playerId)).toEqual(beforeInventory);
    expect(runtime.server.canonicalResidencyDiagnostics.residentCount).toBe(0);

    const tickBefore = ready.snapshot.physicsTick;
    const duringPrepare = runtime.wake(100);
    expect(duringPrepare.physicsTick).toBeGreaterThan(tickBefore);
    expect(
      runtime.acceptGeneratedChunk({
        key: chunkKey(64, 2, 0),
        cx: 64,
        cy: 2,
        cz: 0,
        chunkRevision: 0,
        generatorVersion: runtime.server.generatorVersion,
        canonical: new Uint16Array(32 ** 3),
      }),
    ).toBe(true);

    const result = await placing;
    expect(result.result).toMatchObject({ success: true });
    expect(runtime.server.peekLoadedVoxel(2_049, 80, 0)?.voxel).toBe(Voxel.Dirt);
    expect(runtime.server.getInventory(ready.playerId).slots[0]).toEqual({
      itemId: ItemIds.DirtBlock,
      count: 1,
    });
  });

  it('破坏与攻击在目标或LOS未知时保守失败且不改变玩法状态', () => {
    const gameplay = new GameplayRuntime({
      platform: testCorePlatform,
      getVoxel: () => undefined,
      prepareVoxelEdit: () => {
        throw new Error('未知Chunk不应进入prepareVoxelEdit。');
      },
      getWorldTime: () => 9,
    });
    gameplay.spawnPlayer({ id: 'player', position: [0.5, 1, 0.5] });
    gameplay.spawn({
      id: 'creature',
      type: 'creature',
      archetype: 'grazer',
      position: [2.5, 1, 0.5],
      health: 12,
      maxHealth: 12,
    });

    expect(gameplay.beginBreak('player', [1, 1, 0])).toEqual({ success: false, reason: 'chunk-unavailable' });
    expect(gameplay.attackEntity('player', 'creature')).toEqual({ success: false, reason: 'chunk-unavailable' });
    expect(gameplay.getEntity('creature')?.health).toBe(12);
    expect(gameplay.getPlayerState('player').attackCooldownSeconds).toBe(0);
  });

  it('Actor权威攻击遇到未知LOS时返回chunk-unavailable且不伤害玩家', () => {
    const gameplay = new GameplayRuntime({
      platform: testCorePlatform,
      getVoxel: () => undefined,
      prepareVoxelEdit: () => {
        throw new Error('Actor LOS不得同步写世界。');
      },
      getWorldTime: () => 9,
    });
    gameplay.spawnPlayer({ id: 'player', position: [2.5, 1, 0.5] });
    gameplay.spawnAutonomous(
      {
        id: 'hostile',
        type: 'creature',
        archetype: 'night-stalker',
        position: [0.9, 1, 0.5],
        health: 16,
        maxHealth: 16,
      },
      { archetype: 'night-stalker' },
    );
    expect(
      applyActorAuthorityAction(
        {
          entities: gameplay.entities,
          items: gameplay.content.items,
          simulation: gameplay.simulation,
          getVoxel: () => undefined,
          isPlayerAlive: () => true,
          touch: vi.fn(),
        },
        'hostile',
        { type: 'attack', targetId: 'player' },
      ),
    ).toMatchObject({ accepted: false, reason: 'chunk-unavailable' });
  });
});
