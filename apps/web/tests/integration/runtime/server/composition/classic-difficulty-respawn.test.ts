import { expect, it } from 'vitest';
import { createDifficultyRuntime } from '@seedlands/stdlib/server/gameplay/difficulty-runtime';
import { hostileActorsForPeaceful } from '@seedlands/stdlib/server/gameplay/difficulty-runtime';
import { setSpawnFromBed } from '@seedlands/stdlib/server/gameplay/bed-action';
import {
  PlayerState,
  Inventory,
  GameplayRuntime,
  craftRecipe,
  classicOptions,
} from '../../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { applyAuthorityPlayerAction } from '../../../../../../../packages/stdlib/src/server/authority/authority-player-action';

const world = () => {
  const runtime = new GameplayRuntime({
    ...classicOptions(),
    platform: testCorePlatform,
    getWorldTime: () => 12,
    getVoxel: () => 0,
    prepareVoxelEdit: () => {
      throw new Error('unexpected voxel edit');
    },
  });
  runtime.spawnPlayer({ id: 'player', position: [0, 10, 0] });
  return runtime;
};

it('难度伤害倍率、revision 与恢复保持确定', () => {
  const runtime = createDifficultyRuntime();
  expect(runtime.damage(4)).toBe(4);
  expect(runtime.set('hard', 0)).toMatchObject({ success: true, changed: true, checkpoint: { revision: 1 } });
  expect(runtime.damage(4)).toBe(6);
  expect(runtime.set('easy', 0)).toEqual({ success: false, reason: 'stale-revision' });
  const restored = createDifficultyRuntime(runtime.checkpoint());
  expect(restored.value).toBe('hard');
  expect(restored.set('peaceful', 1)).toMatchObject({ success: true, changed: true });
  expect(restored.damage(20)).toBe(0);
});

it('peaceful 清退计划稳定排序并保留被动、中立和已驯服实体', () => {
  expect(
    hostileActorsForPeaceful([
      { id: 'zombie-b', disposition: 'hostile' },
      { id: 'cow', disposition: 'passive' },
      { id: 'wolf', disposition: 'neutral' },
      { id: 'zombie-a', disposition: 'hostile' },
      { id: 'tamed-hostile', disposition: 'hostile', tamed: true },
    ]),
  ).toEqual(['zombie-a', 'zombie-b']);
});

it('玩家重生点更新后进入 snapshot 并被 respawn 使用', () => {
  const player = new PlayerState('player', [0, 10, 0]);
  expect(player.setSpawnPosition([5, 20, -3])).toBe(true);
  player.health = 0;
  player.lifecycle = 'dead';
  player.respawn();
  expect(player.snapshot()).toMatchObject({ health: 20, lifecycle: 'alive', spawnPosition: [5, 20, -3] });
  expect(player.setSpawnPosition([Infinity, 0, 0])).toBe(false);
});

it('床配方守恒且只把安全位置提交为重生点', () => {
  const bag = new Inventory(36);
  bag.add({ itemId: 'plank', count: 3 });
  bag.add({ itemId: 'wool', count: 3 });
  expect(craftRecipe(bag, 'bed')).toMatchObject({ success: true });
  const player = new PlayerState('sleeper', [0, 10, 0]);
  expect(setSpawnFromBed(player, [4, 10, 4], () => null)).toEqual({ success: false, reason: 'unsafe-spawn' });
  expect(player.spawnPosition).toEqual([0, 10, 0]);
  expect(setSpawnFromBed(player, [4, 10, 4], () => [4.5, 11, 4.5])).toEqual({
    success: true,
    spawnPosition: [4.5, 11, 4.5],
  });
});

it('GameplayRuntime 持久化难度，peaceful 清退敌对生物并从床边复活', () => {
  const source = world();
  source.spawnAutonomous(
    { id: 'zombie', type: 'creature', archetype: 'zombie', position: [2, 10, 0] },
    { archetype: 'zombie' },
  );
  source.spawnAutonomous({ id: 'cow', type: 'creature', archetype: 'cow', position: [4, 10, 0] }, { archetype: 'cow' });
  expect(source.setDifficulty('hard', 0)).toMatchObject({ success: true, checkpoint: { revision: 1 } });
  const saved = source.createSnapshot();
  const restored = world();
  restored.restoreSnapshot(saved);
  expect(restored.difficulty.checkpoint()).toEqual({ version: 1, value: 'hard', revision: 1 });
  expect(restored.setDifficulty('peaceful', 1)).toMatchObject({ success: true, changed: true });
  expect(restored.getEntity('zombie')).toBeNull();
  expect(restored.getEntity('cow')).not.toBeNull();
  restored.giveItem('player', { itemId: 'bed', count: 1 });
  expect(restored.setSpawnFromSelectedBed('player', [5, 10, 5])).toEqual({
    success: true,
    spawnPosition: [5.5, 11, 5.5],
  });
  restored.applyDamage('test', 'player', 20, 'test');
  expect(restored.respawnPlayer('player')).toEqual({ success: true });
  expect(restored.getEntity('player')?.position).toEqual([5.5, 11, 5.5]);
});

it('浏览器难度 action 经 Authority 校验 revision 并投影当前状态', () => {
  const runtime = new (class {
    readonly gameplay = world();
    readonly progress = this.gameplay.progress;
    setDifficulty = this.gameplay.setDifficulty;
  })();
  expect(
    applyAuthorityPlayerAction(
      runtime as never,
      'player',
      { type: 'set-difficulty', value: 'hard', expectedRevision: 0 },
      () => {},
    ),
  ).toMatchObject({ success: true, checkpoint: { value: 'hard', revision: 1 } });
  expect(
    applyAuthorityPlayerAction(
      runtime as never,
      'player',
      { type: 'set-difficulty', value: 'easy', expectedRevision: 0 },
      () => {},
    ),
  ).toEqual({ success: false, reason: 'stale-revision' });
});
