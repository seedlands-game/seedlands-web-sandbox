import { expect, it } from 'vitest';
import { EnvironmentRuntime } from '@seedlands/stdlib/server/gameplay/environment-runtime';
import { GameplayRuntime, classicOptions } from '../../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';

it('天气、火扩散/雨熄灭与恢复由 seed/tick 确定', () => {
  const env = new EnvironmentRuntime(42);
  env.ignite([0, 1, 0], 10);
  const clear = env.advance(1, { flammable: ([x]) => x === 1, skyVisible: () => true });
  expect(clear.extinguished).toEqual([]);
  env.setWeather('rain', 10);
  expect(env.advance(1, { flammable: () => true, skyVisible: () => true }).extinguished).toEqual([[0, 1, 0]]);
  const restored = new EnvironmentRuntime(42, env.checkpoint());
  expect(restored.checkpoint()).toEqual(env.checkpoint());
  const legacy = env.checkpoint();
  const migrated = new EnvironmentRuntime(42, {
    ...legacy,
    dungeonSpawners: undefined,
    openedDungeonChests: undefined,
  });
  expect(migrated.checkpoint().dungeonSpawners).toEqual([]);
  expect(migrated.checkpoint().openedDungeonChests).toEqual([]);
});

it('GameplayRuntime 通过 World.edit 批次提交火与爆炸并恢复环境状态', () => {
  const cells = new Map<string, number>([
    ['0,0,0', Voxel.Fire],
    ['1,0,0', Voxel.Planks],
    ['3,0,0', Voxel.Tnt],
  ]);
  const callbacks = {
    ...classicOptions(),
    platform: testCorePlatform,
    environmentSeed: 99,
    getWorldTime: () => 12,
    getVoxel: ([x, y, z]: [number, number, number]) => cells.get([x, y, z].join(',')) ?? Voxel.Air,
    prepareVoxelEdit: () => {
      throw new Error('single edit unexpected');
    },
    editBatch: ({ edits }: { edits?: readonly { x: number; y: number; z: number; value: number }[] }) => {
      for (const edit of edits ?? []) cells.set([edit.x, edit.y, edit.z].join(','), edit.value);
      return {
        committed: true,
        worldRevision: 1,
        structuralChange: null,
        semanticEvents: [],
        metrics: {
          timingStatus: 'not-collected-hot-path' as const,
          inputMutationCount: edits?.length ?? 0,
          canonicalWriteCount: edits?.length ?? 0,
          dirtyChunkCount: 0,
          meshInvalidationCount: 0,
          structuralEventCount: 0 as const,
          semanticEventCount: 0,
          mutationPayloadBytes: 0,
          mutationCapacityBytes: 0,
          validationMs: 0,
          resolveMs: 0,
          applyMs: 0,
          commitMs: 0,
        },
      };
    },
  };
  const world = new GameplayRuntime(callbacks);
  world.spawnPlayer({ id: 'player', position: [3, 0, 1] });
  world.igniteEnvironment([0, 0, 0], 10);
  for (let i = 0; i < 4; i++) world.advanceRules(1);
  expect([...cells.values()]).toContain(Voxel.Fire);
  world.environment.setWeather('rain', 10);
  world.advanceRules(1);
  expect(cells.get('0,0,0')).toBe(Voxel.Air);
  world.primeEnvironmentTnt([3, 0, 0], 1, 1);
  const checkpoint = world.createSnapshot();
  const restored = new GameplayRuntime(callbacks);
  restored.spawnPlayer({ id: 'player', position: [3, 0, 1] });
  restored.restoreSnapshot(checkpoint);
  restored.advanceRules(1);
  expect(cells.get('3,0,0')).toBe(Voxel.Air);
  expect(restored.getPlayerState('player').health).toBeLessThan(20);
  expect(restored.getEntity('player')?.physicsVelocity?.[1]).toBeGreaterThan(0);
});

it('TNT 引信按稳定 id 产生有界球形爆炸候选', () => {
  const env = new EnvironmentRuntime(7);
  expect(env.primeTnt([0, 0, 0], 1, 2).id).toBe(1);
  expect(env.advance(0.5, { flammable: () => false, skyVisible: () => false }).explosions).toEqual([]);
  const effects = env.advance(0.5, { flammable: () => false, skyVisible: () => false });
  expect(effects.explosions[0].id).toBe(1);
  expect(effects.explosions[0].blocks).toContainEqual([0, 0, 0]);
  expect(effects.explosions[0].blocks.every(([x, y, z]) => x * x + y * y + z * z <= 4)).toBe(true);
});
