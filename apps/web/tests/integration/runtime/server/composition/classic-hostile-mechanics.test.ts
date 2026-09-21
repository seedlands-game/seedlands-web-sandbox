import { expect, it } from 'vitest';
import { GameplayRuntime, classicOptions } from '../../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';

const createWorld = () => {
  const world = new GameplayRuntime({
    ...classicOptions(),
    platform: testCorePlatform,
    getWorldTime: () => 0,
    getVoxel: () => Voxel.Air,
    getLoadedVoxel: () => Voxel.Air,
    prepareVoxelEdit: () => {
      throw new Error('unexpected');
    },
  });
  world.spawnPlayer({ id: 'player', position: [4, 0, 0] });
  world.spawnAutonomous({ id: 'skeleton', archetype: 'skeleton', position: [0, 0, 0] }, { archetype: 'skeleton' });
  world.spawnAutonomous({ id: 'creeper', archetype: 'creeper', position: [3, 0, 3] }, { archetype: 'creeper' });
  world.spawnAutonomous({ id: 'slime', archetype: 'slime', position: [6, 0, 0] }, { archetype: 'slime' });
  return world;
};

it('骷髅远程攻击使用世界投射物 owner 并在恢复后命中', () => {
  const world = createWorld();
  expect(world.speciesInteractions.fireSkeleton('skeleton', 'player')).toMatchObject({
    success: true,
    projectile: { ownerId: 'skeleton' },
  });
  const restored = createWorld();
  restored.restoreSnapshot(world.createSnapshot());
  restored.projectiles.advance(0.4);
  expect(restored.getPlayerState('player').health).toBeLessThan(20);
});

it('苦力怕引信和史莱姆尺寸机制拒绝错误物种并保存', () => {
  const world = createWorld();
  expect(world.speciesInteractions.primeCreeper('skeleton')).toEqual({ success: false, reason: 'invalid-creeper' });
  expect(world.speciesInteractions.primeCreeper('creeper')).toMatchObject({ success: true, tnt: { fuseSeconds: 1.5 } });
  expect(world.speciesInteractions.primeCreeper('creeper')).toEqual({ success: false, reason: 'already-primed' });
  const primed = world.createSnapshot();
  expect(world.speciesInteractions.splitSlime('slime')).toMatchObject({
    success: true,
    children: [{ archetype: 'slime' }, { archetype: 'slime' }],
  });
  expect(world.getEntity('slime')).toBeNull();
  const restored = createWorld();
  restored.restoreSnapshot(world.createSnapshot());
  expect(
    restored.queryEntities({ type: 'creature' }).filter((entity) => entity.id.startsWith('slime-child-')),
  ).toHaveLength(2);
  const explosion = createWorld();
  explosion.restoreSnapshot(primed);
  explosion.advanceRules(1.5);
  expect(explosion.getEntity('creeper')).toBeNull();
});
