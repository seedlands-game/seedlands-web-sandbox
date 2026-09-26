import { expect, it, vi } from 'vitest';
import { createProjectileRuntime } from '@seedlands/stdlib/server/gameplay/projectile-runtime';
import { fireSelectedRangedItem } from '@seedlands/stdlib/server/gameplay/ranged-action';
import { createItemDefinitionRegistry } from '@seedlands/stdlib/server/gameplay/item-registry';
import { GameplayRuntime, getItemDefinition, Inventory, craftRecipe } from '../../../../fixtures/classic/content';
import { classicGameplayDomainOptions } from './classic-gameplay-domain-options';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';

it('弓箭材料与配方守恒，缺箭发射前可原子拒绝', () => {
  expect(getItemDefinition('bow').capabilities).toContainEqual({
    type: 'ranged',
    damage: 4,
    speed: 16,
    lifetimeSeconds: 5,
    ammunitionItemId: 'arrow',
  });
  expect(getItemDefinition('arrow')).toBeDefined();
  for (const [recipe, inputs, count] of [
    [
      'bow',
      [
        ['stick', 3],
        ['string', 3],
      ],
      1,
    ],
    [
      'arrows',
      [
        ['flint', 1],
        ['stick', 1],
        ['feather', 1],
      ],
      4,
    ],
  ] as const) {
    const bag = new Inventory(36);
    for (const [itemId, amount] of inputs) if (amount > 1) bag.add({ itemId, count: amount - 1 });
    const before = bag.snapshot();
    expect(craftRecipe(bag, recipe)).toMatchObject({ success: false });
    expect(bag.snapshot()).toEqual(before);
    for (const [itemId] of inputs) bag.add({ itemId, count: 1 });
    expect(craftRecipe(bag, recipe)).toMatchObject({ success: true });
    const output = recipe === 'arrows' ? 'arrow' : recipe;
    expect(bag.snapshot().find((stack) => stack?.itemId === output)?.count).toBe(count);
  }
});

it('内容注册在弹药缺失或投射参数非法时拒绝', () => {
  const bow = {
    id: 'bow',
    name: '弓',
    itemType: 'tool' as const,
    stackLimit: 1,
    durability: { max: 1 },
    capabilities: [{ type: 'ranged' as const, ammunitionItemId: 'arrow', damage: 4, speed: 16, lifetimeSeconds: 5 }],
  };
  expect(() => createItemDefinitionRegistry([bow])).toThrow(/unknown ammunition/);
  expect(() =>
    createItemDefinitionRegistry([
      { ...bow, capabilities: [{ ...bow.capabilities[0], speed: 0 }] },
      { id: 'arrow', name: '箭', itemType: 'resource', stackLimit: 64, capabilities: [] },
    ]),
  ).toThrow(/Ranged capability/);
});

it('正式发射缺箭原子拒绝，成功时扣箭与弓耐久且生成一支箭', () => {
  const environment = { firstVoxelHit: () => null, firstActorHit: () => null, applyDamage: vi.fn() };
  const projectiles = createProjectileRuntime(environment);
  const bag = new Inventory(36);
  bag.add({ itemId: 'bow', count: 1, instance: { durability: 2 } });
  const before = bag.snapshot();
  const request = {
    ownerId: 'player',
    selectedSlot: 0,
    position: { x: 0, y: 1, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    inventory: bag,
    items: bag.items,
    projectiles,
  };
  expect(fireSelectedRangedItem(request)).toEqual({ success: false, reason: 'missing-ammunition' });
  expect(bag.snapshot()).toEqual(before);
  expect(projectiles.list()).toEqual([]);
  bag.add({ itemId: 'arrow', count: 2 });
  expect(fireSelectedRangedItem(request)).toMatchObject({ success: true, projectile: { id: 1, damage: 4 } });
  expect(bag.slot(0)?.instance?.durability).toBe(1);
  expect(bag.snapshot().find((stack) => stack?.itemId === 'arrow')?.count).toBe(1);
});

it('投射物选择最早命中且体素同距优先，命中后只结算一次', () => {
  const applyDamage = vi.fn();
  let blocked = true;
  const runtime = createProjectileRuntime({
    firstVoxelHit: () => (blocked ? { fraction: 0.5 } : null),
    firstActorHit: () => ({ fraction: 0.5, targetId: 'target' }),
    applyDamage,
  });
  runtime.fire({
    ownerId: 'player',
    position: { x: 0, y: 1, z: 0 },
    direction: { x: 2, y: 0, z: 0 },
    speed: 16,
    damage: 4,
    lifetimeSeconds: 5,
  });
  runtime.advance(0.25);
  expect(applyDamage).not.toHaveBeenCalled();
  blocked = false;
  runtime.fire({
    ownerId: 'player',
    position: { x: 0, y: 1, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    speed: 16,
    damage: 4,
    lifetimeSeconds: 5,
  });
  runtime.advance(0.25);
  runtime.advance(0.25);
  expect(applyDamage).toHaveBeenCalledTimes(1);
  expect(applyDamage).toHaveBeenCalledWith('player', 'target', 4);
});

it('在途箭保存恢复后继续，id 高水位不重用且寿命到期销毁', () => {
  const environment = { firstVoxelHit: () => null, firstActorHit: () => null, applyDamage: vi.fn() };
  const first = createProjectileRuntime(environment);
  expect(
    first.fire({
      ownerId: 'player',
      position: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      speed: 2,
      damage: 4,
      lifetimeSeconds: 1,
    }).id,
  ).toBe(1);
  first.advance(0.25);
  const restored = createProjectileRuntime(environment, first.checkpoint());
  expect(restored.list()[0]).toMatchObject({ id: 1, position: { x: 0.5 }, remainingSeconds: 0.75 });
  expect(
    restored.fire({
      ownerId: 'player',
      position: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 1, z: 0 },
      speed: 1,
      damage: 4,
      lifetimeSeconds: 0.25,
    }).id,
  ).toBe(2);
  restored.advance(0.75);
  expect(restored.list()).toEqual([]);
});

it('GameplayRuntime 持有投射物并在保存恢复后通过正式伤害入口命中', () => {
  const createWorld = () =>
    new GameplayRuntime({
      ...classicGameplayDomainOptions(),
      platform: testCorePlatform,
      getWorldTime: () => 0,
      getVoxel: () => Voxel.Air,
      getLoadedVoxel: () => Voxel.Air,
      prepareVoxelEdit: () => {
        throw new Error('unexpected edit');
      },
    });
  const source = createWorld();
  source.spawnPlayer({ id: 'archer', position: [0, 0, 0] });
  source.spawnAutonomous({ id: 'target', archetype: 'zombie', position: [3, 0, 0] }, { archetype: 'zombie' });
  source.giveItem('archer', { itemId: 'bow', count: 1, instance: { durability: 2 } });
  source.giveItem('archer', { itemId: 'arrow', count: 2 });
  expect(source.fireSelectedRangedItem('archer', { x: 1, y: 0, z: 0 })).toMatchObject({ success: true });
  source.projectiles.advance(0.05);
  const snapshot = source.createSnapshot();
  expect(snapshot.projectiles?.projectiles).toHaveLength(1);
  const restored = createWorld();
  restored.restoreSnapshot(snapshot);
  restored.projectiles.advance(0.2);
  expect(restored.getEntity('target')?.health).toBe(16);
  expect(restored.projectiles.list()).toEqual([]);
  expect(restored.getInventory('archer').slots.find((stack) => stack?.itemId === 'arrow')?.count).toBe(1);
});
