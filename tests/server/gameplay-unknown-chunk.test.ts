import { describe, expect, it, vi } from 'vitest';
import { AuthorityRuntime } from '../../src/server/authority/authority-runtime';
import { applyActorAuthorityAction } from '../../src/server/gameplay/actor-authority-gameplay';
import { GameplayRuntime } from '../../src/server/gameplay/gameplay-runtime';
import { ItemIds } from '../../src/server/gameplay/item-registry';
import { Voxel, chunkKey } from '../../src/world/voxel';

describe('玩法事务只读取已加载权威Chunk', () => {
  it('未知目标返回chunk-unavailable，不同步生成、不扣库存，并可在异步准备期间继续物理步', async () => {
    const requested: string[] = [];
    const runtimeRef: { current?: AuthorityRuntime } = {};
    let prepared: Promise<void> | undefined;
    const runtime = await AuthorityRuntime.create({
      epoch: 'unknown-gameplay:1',
      seedText: 'unknown-gameplay',
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
      onUnknownChunk: (key) => {
        requested.push(key);
        if (key !== chunkKey(64, 2, 0) || prepared) return;
        prepared = Promise.resolve().then(() => {
          const accepted = runtimeRef.current!.acceptGeneratedChunk({
            key,
            cx: 64,
            cy: 2,
            cz: 0,
            chunkRevision: 0,
            generatorVersion: runtimeRef.current!.server.generatorVersion,
            canonical: new Uint16Array(32 ** 3),
          });
          expect(accepted).toBe(true);
        });
      },
    });
    runtimeRef.current = runtime;
    const ready = runtime.ready();
    runtime.setPlayerPosition([2_048.5, 80, 0.5]);
    runtime.server.giveItem(ready.playerId, { itemId: ItemIds.DirtBlock, count: 2 });
    runtime.server.selectHotbarSlot(ready.playerId, 0);
    const beforeInventory = runtime.server.getInventory(ready.playerId);

    const unavailable = runtime.performAction({ type: 'place', position: [2_049, 80, 0] });
    expect(unavailable.result).toEqual({ success: false, reason: 'chunk-unavailable' });
    expect(runtime.server.getInventory(ready.playerId)).toEqual(beforeInventory);
    expect(runtime.server.canonicalResidencyDiagnostics.residentCount).toBe(0);
    expect(requested).toContain('64,2,0');

    const tickBefore = ready.snapshot.physicsTick;
    const duringPrepare = runtime.wake(100);
    expect(duringPrepare.physicsTick).toBeGreaterThan(tickBefore);
    await prepared;

    const retry = runtime.performAction({ type: 'place', position: [2_049, 80, 0] });
    expect(retry.result).toMatchObject({ success: true });
    expect(runtime.server.peekLoadedVoxel(2_049, 80, 0)?.voxel).toBe(Voxel.Dirt);
    expect(runtime.server.getInventory(ready.playerId).slots[0]).toEqual({
      itemId: ItemIds.DirtBlock,
      count: 1,
    });
  });

  it('破坏与攻击在目标或LOS未知时保守失败且不改变玩法状态', () => {
    const gameplay = new GameplayRuntime({
      getVoxel: () => undefined,
      editVoxel: () => {
        throw new Error('未知Chunk不应进入editVoxel。');
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
      getVoxel: () => undefined,
      editVoxel: () => {
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
    const damagePlayer = vi.fn(() => true);

    expect(
      applyActorAuthorityAction(
        {
          entities: gameplay.entities,
          simulation: gameplay.simulation,
          getVoxel: () => undefined,
          isPlayerAlive: () => true,
          damagePlayer,
          touch: vi.fn(),
        },
        'hostile',
        { type: 'attack', targetId: 'player' },
      ),
    ).toMatchObject({ accepted: false, reason: 'chunk-unavailable' });
    expect(damagePlayer).not.toHaveBeenCalled();
  });
});
