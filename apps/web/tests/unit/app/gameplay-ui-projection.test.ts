import { describe, expect, it } from 'vitest';
import { projectGameplayUi } from '../../../src/app/ui/gameplay-ui-projector';
import type { ItemDefinition } from '@seedlands/stdlib/server/gameplay/item-registry';
import { classicContent } from '../../fixtures/classic/content';

const snapshot = () => ({
  recipes: classicContent.recipes.list(),
  stationRecipes: classicContent.stations!.listRecipes(),
  revision: 7,
  inventoryView: {
    actor: { entityId: 'player', epoch: 1, lifetime: 1 },
    armor: {
      helmet: { itemId: 'iron-helmet', count: 1, instance: { durability: 41 } },
      chestplate: null,
      leggings: null,
      boots: null,
    },
    cursor: {
      version: 1 as const,
      revision: 2,
      stack: null,
      origin: null,
      craftingGrid: [{ itemId: 'wood-block', count: 1 }, null, null, null],
    },
    matchedCraftingRecipeIds: ['planks'],
  },
  player: {
    lifecycle: 'alive' as const,
    health: 12,
    hunger: 9,
    selectedHotbarSlot: 2,
    inventory: [
      { itemId: 'dirt-block', count: 5 },
      null,
      { itemId: 'wood-axe', count: 1, instance: { durability: 59 } },
      ...Array.from({ length: 21 }, () => null),
    ],
  },
  inventoryOpen: true,
  craftableRecipeIds: ['planks'],
  armorPoints: 14,
  oxygen: { value: 12, max: 20, visible: true },
  progress: { playerId: 'player', statistics: { 'blocks-mined': 3 }, achievements: ['first-block'] as const },
  target: { kind: 'voxel' as const, id: '0,33,-2', label: '原木' },
  breaking: { progress: 0.5, label: '原木' },
});

describe('gameplay retained UI projection', () => {
  it('partitions canonical state into HUD, interaction and shell snapshots', () => {
    const projected = projectGameplayUi(snapshot());

    expect(projected.hud).toMatchObject({
      health: { value: 12, max: 20 },
      hunger: { value: 9, max: 20 },
      armor: { value: 14, max: 20 },
      oxygen: { value: 12, max: 20, visible: true },
      selectedHotbarSlot: 2,
    });
    expect(projected.hud.hotbar).toHaveLength(8);
    expect(projected.hud.hotbar[2].durability).toEqual({ current: 59, max: 60 });
    expect(projected.interaction).toMatchObject({
      target: { kind: 'voxel', id: '0,33,-2', label: '原木' },
      breaking: { progress: 0.5, label: '原木' },
    });
    expect(projected.shell.gameplay).toMatchObject({
      inventoryOpen: true,
      lifecycle: 'alive',
      craftableRecipeIds: ['planks'],
      selectedHotbarSlot: 2,
      progress: { statistics: { 'blocks-mined': 3 }, achievements: ['first-block'] },
    });
    expect(projected.shell.gameplay.inventory).toHaveLength(24);
    expect(projected.shell.gameplay).toMatchObject({
      equipment: {
        helmet: {
          slot: 'helmet',
          itemId: 'iron-helmet',
          count: 1,
          name: '铁头盔',
          durability: { current: 41, max: 165 },
        },
        chestplate: { slot: 'chestplate', itemId: null, count: 0, name: '空胸甲槽' },
        leggings: { slot: 'leggings', itemId: null, count: 0, name: '空护腿槽' },
        boots: { slot: 'boots', itemId: null, count: 0, name: '空靴子槽' },
      },
    });
    expect(projected.shell.gameplay.personalCrafting.slots).toHaveLength(4);
    expect(projected.shell.gameplay.personalCrafting.slots[0]).toMatchObject({ itemId: 'wood-block', count: 1 });
    expect(projected.shell.gameplay.personalCrafting.recipes).toContainEqual(
      expect.objectContaining({ id: 'planks', matchesGrid: true, pattern: expect.any(Array) }),
    );
    expect(
      projected.shell.gameplay.personalCrafting.recipes.find((recipe) => recipe.id === 'planks')?.pattern,
    ).toHaveLength(4);
    expect(projected.shell.gameplay.personalCrafting.recipes.some((recipe) => recipe.id === 'wood-pickaxe')).toBe(
      false,
    );
    expect(projected.shell.gameplay.personalCrafting.recipes.some((recipe) => recipe.id === 'chest')).toBe(false);
    expect(projected.shell.gameplay.creativeCatalog).toContainEqual(
      expect.objectContaining({ itemId: 'white-wool', name: '白色羊毛' }),
    );
    expect(projected.shell.gameplay.recipes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'planks', name: '木板', craftable: true }),
        expect.objectContaining({ id: 'wood-axe', name: '木斧', craftable: false }),
        expect.objectContaining({ id: 'stone-pickaxe', name: '石镐', craftable: false }),
        expect.objectContaining({ id: 'wood-sword', name: '木剑', craftable: false }),
        expect.objectContaining({ id: 'lantern', name: '灯笼', craftable: false }),
        expect.objectContaining({ id: 'workbench', name: '工作台', craftable: false }),
      ]),
    );
  });

  it('does not expose mutable canonical inventory references', () => {
    const source = snapshot();
    const projected = projectGameplayUi(source);

    source.player.inventory[0] = { itemId: 'stone-block', count: 64 };
    source.inventoryView.armor.helmet!.instance!.durability = 1;
    expect(projected.hud.hotbar[0]).toMatchObject({ itemId: 'dirt-block', count: 5 });
    expect(projected.shell.gameplay.inventory[0]).toMatchObject({ itemId: 'dirt-block', count: 5 });
    expect(projected.shell.gameplay).toMatchObject({
      equipment: { helmet: { itemId: 'iron-helmet', durability: { current: 41, max: 165 } } },
    });
  });

  it('reuses unchanged retained partitions for channel coalescing', () => {
    const first = projectGameplayUi(snapshot());
    const second = projectGameplayUi(snapshot(), first);

    expect(second.hud).toBe(first.hud);
    expect(second.interaction).toBe(first.interaction);
    expect(second.shell).toBe(first.shell);
  });

  it('replaces only the retained shell partition when committed armor changes', () => {
    const source = snapshot();
    const first = projectGameplayUi(source);
    source.inventoryView.armor.helmet!.instance!.durability = 40;
    const second = projectGameplayUi(source, first);

    expect(second.shell).not.toBe(first.shell);
    expect(second.hud).toBe(first.hud);
    expect(second.interaction).toBe(first.interaction);
    expect(second.shell.gameplay).toMatchObject({ equipment: { helmet: { durability: { current: 40, max: 165 } } } });
  });

  it('projects non-Classic armor from the current world item definitions', () => {
    const visor: ItemDefinition = {
      id: 'sample:visor',
      name: '星航面罩',
      itemType: 'armor',
      stackLimit: 1,
      durability: { max: 40 },
      capabilities: [{ type: 'armor', slot: 'helmet', points: 2 }],
    };
    const source = snapshot();
    const projected = projectGameplayUi({
      ...source,
      items: [...classicContent.items.list(), visor],
      inventoryView: {
        ...source.inventoryView,
        armor: {
          ...source.inventoryView.armor,
          helmet: { itemId: 'sample:visor', count: 1, instance: { durability: 37 } },
        },
      },
    });

    expect(projected.shell.gameplay.equipment.helmet).toEqual({
      slot: 'helmet',
      itemId: 'sample:visor',
      count: 1,
      name: '星航面罩',
      edible: false,
      stackLimit: 1,
      durability: { current: 37, max: 40 },
    });
  });
});
