import { expect, it } from 'vitest';
import {
  assembleOverworldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/stdlib/host';
import { definePack } from '@seedlands/stdlib/mod-api';
import {
  classicContent,
  getItemDefinition,
  Inventory,
  craftRecipe,
  GameplayRuntime,
} from '../../../../fixtures/classic/content';
import { classicGameplayDomainModules, classicGameplayDomainOptions } from './classic-gameplay-domain-options';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { pack } from '../../../../../../../playbooks/classic/src/pack';
import {
  armorDamageReduction,
  ARMOR_MAX_POINTS,
} from '../../../../../../../packages/stdlib/src/server/gameplay/modules/armor-policy';

const pieces = [
  { id: 'leather-helmet', slot: 'helmet', material: 'leather', points: 1 },
  { id: 'leather-chestplate', slot: 'chestplate', material: 'leather', points: 3 },
  { id: 'iron-helmet', slot: 'helmet', material: 'iron-ingot', points: 2 },
  { id: 'iron-chestplate', slot: 'chestplate', material: 'iron-ingot', points: 6 },
  { id: 'diamond-chestplate', slot: 'chestplate', material: 'diamond', points: 8 },
] as const;

const createFullClassicWorld = () => {
  const deathModuleId = 'seedlands:overworld-death-inventory-policy';
  const selected = definePack({
    id: pack.manifest.id,
    version: pack.manifest.version,
    kind: pack.manifest.kind,
    entry: pack.manifest.entry,
    modules: classicGameplayDomainModules([
      'seedlands:overworld-content',
      ...(pack.modules.some(({ descriptor }) => descriptor.id === deathModuleId) ? [deathModuleId] : []),
    ]),
  });
  const composition = assembleOverworldPacks([
    {
      ...selected,
      integrity: {
        algorithm: 'sha256',
        manifestDigest: 'a'.repeat(64),
        entryDigest: 'b'.repeat(64),
        resources: [],
      },
    },
  ]);
  return new GameplayRuntime({
    composition,
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'test-player' }),
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    platform: testCorePlatform,
    getWorldTime: () => 12,
    getVoxel: () => 0,
    prepareVoxelEdit: () => {
      throw new Error('unexpected');
    },
  });
};

it('护甲物品注册为可穿戴且带防护点数与耐久', () => {
  for (const piece of pieces) {
    const definition = getItemDefinition(piece.id);
    expect(definition.itemType).toBe('armor');
    const armor = classicContent.items.capability(piece.id, 'armor');
    expect(armor).toMatchObject({ type: 'armor', slot: piece.slot, points: piece.points });
    expect(definition.durability?.max).toBeGreaterThan(0);
  }
});

it('正式装备槽参与伤害减免、扣耐久并随 snapshot 恢复', () => {
  const create = () => {
    const world = new GameplayRuntime({
      ...classicGameplayDomainOptions(),
      platform: testCorePlatform,
      getWorldTime: () => 12,
      getVoxel: () => 0,
      prepareVoxelEdit: () => {
        throw new Error('unexpected');
      },
    });
    world.spawnPlayer({ id: 'player', position: [0, 1, 0] });
    world.spawnAutonomous(
      { id: 'hostile', type: 'creature', archetype: 'zombie', position: [1, 1, 0] },
      { archetype: 'zombie' },
    );
    return world;
  };
  const world = create();
  world.giveItem('player', { itemId: 'iron-chestplate', count: 1, instance: { durability: 2 } });
  expect(world.equipSelectedArmor('player')).toMatchObject({ success: true, slot: 'chestplate' });
  expect(world.applyDamage('hostile', 'player', 10, 'combat')).toEqual({ success: true });
  expect(world.getPlayerState('player').health).toBe(12.4);
  expect(world.entities.actorStateAccess('player').armor.chestplate?.instance?.durability).toBe(1);
  const restored = create();
  restored.restoreSnapshot(world.createSnapshot());
  expect(restored.entities.actorStateAccess('player').armor.chestplate?.itemId).toBe('iron-chestplate');
  restored.applyDamage('hostile', 'player', 1, 'combat');
  expect(restored.entities.actorStateAccess('player').armor.chestplate).toBeNull();
});

it('创造模式免伤不磨损护甲，非法伤害保持旧失败语义', () => {
  const world = new GameplayRuntime({
    ...classicGameplayDomainOptions(),
    platform: testCorePlatform,
    getWorldTime: () => 12,
    getVoxel: () => 0,
    prepareVoxelEdit: () => {
      throw new Error('unexpected');
    },
  });
  world.spawnPlayer({ id: 'player', position: [0, 1, 0] });
  world.giveItem('player', { itemId: 'iron-helmet', count: 1, instance: { durability: 2 } });
  world.equipSelectedArmor('player');
  const actor = world.entities.actorStateAccess('player');
  actor.replaceModeComponents({
    mode: { version: 1, value: 'creative', revision: actor.modeRevision + 1 },
    creativeCatalog: {
      ...actor.creativeCatalog,
      hotbar: Array(9).fill(null),
      revision: actor.creativeCatalog.revision + 1,
    },
    flight: actor.flight,
  });
  expect(world.applyDamage('test', 'player', 10, 'combat')).toEqual({ success: true });
  expect(world.entities.actorStateAccess('player').armor.helmet?.instance?.durability).toBe(2);
  expect(world.applyDamage('test', 'player', -1, 'combat')).toEqual({ success: false, reason: 'invalid-damage' });
});

it('Classic direct Vitals 致死一次结算四容器、剩余护甲耐久并保留 player', () => {
  const world = createFullClassicWorld();
  world.spawnPlayer({ id: 'player', position: [0, 1, 0] });
  world.giveItem('player', { itemId: 'iron-helmet', count: 1, instance: { durability: 2 } });
  expect(world.equipSelectedArmor('player')).toMatchObject({ success: true });
  world.giveItem('player', { itemId: 'berry', count: 2 });
  const actor = world.entities.actorStateAccess('player');
  actor.replaceInventoryInteraction(actor.inventoryRevision + 1, {
    version: 1,
    revision: 1,
    stack: { itemId: 'coal', count: 1 },
    origin: { kind: 'inventory', slot: 0 },
    craftingGrid: [{ itemId: 'plank', count: 1 }, null, null, null],
  });
  const beforeRevision = actor.inventoryRevision;
  expect(world.applyDamage('test', 'player', 100, 'test')).toEqual({ success: true });
  expect(world.getEntity('player')).toMatchObject({ type: 'player', health: 0 });
  expect(world.getInventory('player').slots.every((slot) => slot === null)).toBe(true);
  expect(world.getInventoryPointerView('player').cursor).toMatchObject({
    stack: null,
    craftingGrid: [null, null, null, null],
  });
  expect(world.entities.actorStateAccess('player').armor).toEqual({
    helmet: null,
    chestplate: null,
    leggings: null,
    boots: null,
  });
  expect(world.entities.actorStateAccess('player').inventoryRevision).toBe(beforeRevision + 1);
  const settledDrops = world.queryEntities({ type: 'world-item' });
  expect(settledDrops).toHaveLength(4);
  expect(settledDrops.map(({ stack }) => stack)).toEqual(
    expect.arrayContaining([
      { itemId: 'berry', count: 2 },
      { itemId: 'coal', count: 1 },
      { itemId: 'plank', count: 1 },
      { itemId: 'iron-helmet', count: 1, instance: { durability: 1 } },
    ]),
  );
  const drops = world.queryEntities({ type: 'world-item' });
  expect(world.applyDamage('test', 'player', 1, 'test')).toEqual({ success: false, reason: 'player-dead' });
  expect(world.queryEntities({ type: 'world-item' })).toEqual(drops);
});

it('护甲按点数线性减伤，封顶且不为负，空护甲不减伤', () => {
  // Minecraft-style: each point reduces 4% of incoming damage.
  expect(armorDamageReduction(10, 0)).toBe(10);
  expect(armorDamageReduction(10, 5)).toBeCloseTo(10 * (1 - (5 * 4) / 100), 6);
  // Cap at ARMOR_MAX_POINTS (20 → 80% reduction).
  expect(armorDamageReduction(10, 100)).toBeCloseTo(10 * (1 - (ARMOR_MAX_POINTS * 4) / 100), 6);
  // Never negative or above incoming.
  expect(armorDamageReduction(0, 10)).toBe(0);
  expect(() => armorDamageReduction(-1, 5)).toThrow();
  expect(() => armorDamageReduction(10, -1)).toThrow();
});

it('全套铁甲由铁锭合成，头盔 5 锭、胸甲 8 锭并带耐久', () => {
  const bag = new Inventory(36);
  bag.add({ itemId: 'iron-ingot', count: 5 });
  expect(craftRecipe(bag, 'iron-helmet')).toMatchObject({ success: true });
  expect(bag.snapshot().some((s) => s?.itemId === 'iron-helmet')).toBe(true);

  const bag2 = new Inventory(36);
  bag2.add({ itemId: 'iron-ingot', count: 7 });
  expect(craftRecipe(bag2, 'iron-chestplate')).toMatchObject({ success: false });
  bag2.add({ itemId: 'iron-ingot', count: 1 });
  expect(craftRecipe(bag2, 'iron-chestplate')).toMatchObject({ success: true });
});
