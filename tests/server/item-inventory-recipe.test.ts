import { describe, expect, it } from 'vitest';
import { Inventory } from '../../src/server/gameplay/inventory';
import { ItemIds, getItemDefinition } from '../../src/server/gameplay/item-registry';
import { craftRecipe, getRecipe, listCraftableRecipes } from '../../src/server/gameplay/recipe-registry';
import { getVoxelGameplayDefinition } from '../../src/server/gameplay/voxel-gameplay';
import { Voxel } from '../../src/world/voxel';

describe('item and voxel gameplay registries', () => {
  it('keeps ItemId independent from VoxelId and exposes explicit block mappings', () => {
    expect(ItemIds.StoneBlock).toBe('stone-block');
    expect(ItemIds.StoneBlock).not.toBe(Voxel.Stone);
    expect(getItemDefinition(ItemIds.StoneBlock)).toMatchObject({
      stackLimit: 64,
      itemType: 'block',
      placesVoxel: Voxel.Stone,
    });
    expect(getItemDefinition(ItemIds.WoodAxe)).toMatchObject({ stackLimit: 1, itemType: 'tool' });
    expect(getVoxelGameplayDefinition(Voxel.Wood)).toMatchObject({
      hardnessSeconds: 1.2,
      preferredTool: 'axe',
      drop: { itemId: ItemIds.WoodBlock, count: 1 },
    });
    expect(getVoxelGameplayDefinition(Voxel.Water).drop).toBeNull();
  });
});

describe('inventory', () => {
  it('merges existing stacks before allocating empty slots and removes across stacks', () => {
    const inventory = new Inventory(24);
    expect(inventory.add({ itemId: ItemIds.DirtBlock, count: 70 })).toBe(true);
    expect(inventory.snapshot().slice(0, 2)).toEqual([
      { itemId: ItemIds.DirtBlock, count: 64 },
      { itemId: ItemIds.DirtBlock, count: 6 },
    ]);
    expect(inventory.contains({ itemId: ItemIds.DirtBlock, count: 70 })).toBe(true);
    expect(inventory.remove({ itemId: ItemIds.DirtBlock, count: 65 })).toBe(true);
    expect(inventory.snapshot().filter(Boolean)).toEqual([{ itemId: ItemIds.DirtBlock, count: 5 }]);
  });

  it('supports stack splitting without exposing mutable slot state', () => {
    const inventory = new Inventory(24);
    inventory.add({ itemId: ItemIds.Plank, count: 12 });
    expect(inventory.split(0, 5, 3)).toBe(true);
    const first = inventory.snapshot();
    expect(first[0]).toEqual({ itemId: ItemIds.Plank, count: 7 });
    expect(first[3]).toEqual({ itemId: ItemIds.Plank, count: 5 });
    first[0]!.count = 999;
    expect(inventory.snapshot()[0]).toEqual({ itemId: ItemIds.Plank, count: 7 });
  });

  it('keeps add and remove atomic when capacity or quantity is insufficient', () => {
    const inventory = new Inventory(24);
    expect(inventory.add({ itemId: ItemIds.WoodAxe, count: 24 })).toBe(true);
    expect(inventory.snapshot().filter(Boolean)).toHaveLength(24);
    const full = inventory.snapshot();
    expect(inventory.add({ itemId: ItemIds.DirtBlock, count: 1 })).toBe(false);
    expect(inventory.remove({ itemId: ItemIds.WoodAxe, count: 25 })).toBe(false);
    expect(inventory.snapshot()).toEqual(full);
  });
});

describe('recipe runtime', () => {
  it('defines the minimum survival recipe set and reports craftable recipes', () => {
    expect(getRecipe('planks')).toEqual({
      id: 'planks',
      inputs: [{ itemId: ItemIds.WoodBlock, count: 1 }],
      outputs: [{ itemId: ItemIds.Plank, count: 4 }],
    });
    const inventory = new Inventory(24);
    inventory.add({ itemId: ItemIds.WoodBlock, count: 1 });
    expect(listCraftableRecipes(inventory).map((recipe) => recipe.id)).toContain('planks');
  });

  it('crafts atomically and preserves inputs when resources or output capacity are insufficient', () => {
    const inventory = new Inventory(24);
    inventory.add({ itemId: ItemIds.WoodBlock, count: 1 });
    expect(craftRecipe(inventory, 'planks')).toMatchObject({ success: true });
    expect(inventory.contains({ itemId: ItemIds.WoodBlock, count: 1 })).toBe(false);
    expect(inventory.contains({ itemId: ItemIds.Plank, count: 4 })).toBe(true);

    const beforeMissing = inventory.snapshot();
    expect(craftRecipe(inventory, 'stone-pickaxe')).toMatchObject({ success: false, reason: 'missing-inputs' });
    expect(inventory.snapshot()).toEqual(beforeMissing);

    const full = new Inventory(24);
    full.add({ itemId: ItemIds.WoodAxe, count: 23 });
    full.add({ itemId: ItemIds.WoodBlock, count: 64 });
    const beforeFull = full.snapshot();
    expect(craftRecipe(full, 'planks')).toMatchObject({ success: false, reason: 'no-output-capacity' });
    expect(full.snapshot()).toEqual(beforeFull);
  });
});
