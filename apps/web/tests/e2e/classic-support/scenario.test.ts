import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { overworldBlocks } from '../../../../../playbooks/classic/src/blocks';
import { overworldItems } from '../../../../../playbooks/classic/src/items';
import { overworldCraftingRecipes } from '../../../../../playbooks/classic/src/stations';
import { classicScenario } from './scenario';

describe('Classic canonical scenario contract', () => {
  it('moves the complete canonical lane down by 29 blocks without changing its x/z route', () => {
    expect(classicScenario.initialState.floor).toEqual({ from: [-4, 30, -3], to: [224, 30, 3], voxel: 3 });
    expect(classicScenario.initialState.air).toEqual({ from: [-4, 31, -3], to: [224, 37, 3], voxel: 0 });
    expect(classicScenario.initialState.player).toEqual([0.5, 32.6, 0.5]);
    expect(classicScenario.initialState.resourceVoxels.map(({ position }) => position)).toEqual([
      [34, 31, 0],
      [38, 31, 0],
      [42, 31, 0],
      [45, 31, 0],
      [49, 31, 0],
    ]);
    expect(classicScenario.initialState.hostile.position).toEqual([56, 31, 0.5]);
    expect(classicScenario.route).toEqual({
      chunkCrossing: [33, 0.5],
      buildTarget: [52, 31, 0],
      stationTarget: [75, 31, 0],
      hostileApproach: [54, 0.5],
      stationApproach: [72.5, 0.5],
      farTurnaround: [208.5, 0.5],
      returnPoint: [72.5, 0.5],
    });
  });

  it('freezes a V1 slice whose two-cell door crosses the vertical Chunk boundary', () => {
    const slice = classicScenario.v1Slice;
    expect(slice).toEqual({
      water: { support: [68, 30, 2], target: [68, 31, 2], approach: [66, 2.5] },
      door: { support: [70, 30, 0], lower: [70, 31, 0], upper: [70, 32, 0], approach: [67.5, 0.5] },
      jukebox: { support: [76, 30, 2], target: [76, 31, 2], approach: [73.5, 2.5] },
    });
    expect(slice.door.support[1]).toBe(30);
    expect(slice.door.lower[1]).toBe(31);
    expect(slice.door.upper[1]).toBe(32);
    expect(slice.door.upper).toEqual([slice.door.lower[0], slice.door.lower[1] + 1, slice.door.lower[2]]);
    expect(Math.floor(slice.door.lower[1] / 32)).toBe(0);
    expect(Math.floor(slice.door.upper[1] / 32)).toBe(1);
    expect(slice.water.target[1]).toBe(31);
    expect(slice.jukebox.target[1]).toBe(31);
  });

  it('retains every canonical C0-C5 coverage stage', () => {
    const stages = new Set(
      classicScenario.coverage.integratedLegacyBrowserProtection.flatMap(
        ({ stages: protectedStages }) => protectedStages,
      ),
    );
    expect([...stages].sort()).toEqual(['C0', 'C1', 'C2', 'C3', 'C4', 'C5']);
  });

  it('freezes a non-overlapping V2 equipment resource strip in the existing corridor', () => {
    const resources = classicScenario.v2Equipment.resourceStrip;
    expect(resources.map(({ itemId }) => itemId).sort()).toEqual([
      'iron-block',
      'iron-block',
      'iron-block',
      'iron-block',
      'stone-block',
      'stone-block',
      'stone-block',
      'wood-block',
      'wood-block',
      'wood-block',
    ]);
    expect(resources.map(({ target }) => target)).toEqual(
      Array.from({ length: 10 }, (_, index) => [80 + index * 2, 31, 2]),
    );
    expect(classicScenario.v2Equipment.workbench).toEqual({
      support: [78, 30, -2],
      target: [78, 31, -2],
      approach: [78.5, 0.5],
    });
    expect(new Set(resources.map(({ target }) => target.join(',')))).toHaveProperty('size', resources.length);
    for (const resource of resources) {
      expect(resource.support).toEqual([resource.target[0], 30, resource.target[2]]);
      expect(resource.target[1]).toBe(31);
      expect(resource.approach[0]).toBe(resource.target[0] + 0.5);
      expect(resource.approach[1]).toBe(resource.target[2] - 2.5);
      expect(resource.target[0]).toBeGreaterThanOrEqual(classicScenario.initialState.floor.from[0]);
      expect(resource.target[0]).toBeLessThanOrEqual(classicScenario.initialState.floor.to[0]);
      expect(resource.target[2]).toBeGreaterThanOrEqual(classicScenario.initialState.floor.from[2]);
      expect(resource.target[2]).toBeLessThanOrEqual(classicScenario.initialState.floor.to[2]);
    }

    const protectedPositions = [
      ...classicScenario.initialState.resourceVoxels.map(({ position }) => position),
      classicScenario.route.buildTarget,
      classicScenario.route.stationTarget,
      classicScenario.v1Slice.water.target,
      classicScenario.v1Slice.door.lower,
      classicScenario.v1Slice.door.upper,
      classicScenario.v1Slice.jukebox.target,
    ].map((point) => point.join(','));
    expect(
      resources.map(({ target }) => target.join(',')).filter((point) => protectedPositions.includes(point)),
    ).toEqual([]);
    expect(protectedPositions).not.toContain(classicScenario.v2Equipment.workbench.target.join(','));
    expect(resources.map(({ target }) => target.join(','))).not.toContain(
      classicScenario.v2Equipment.workbench.target.join(','),
    );
  });

  it('derives the V2 equipment material budget from registered Classic definitions', () => {
    const items = new Map(overworldItems.map((item) => [item.id, item] as const));
    const blocks = new Map(overworldBlocks.map((block) => [block.voxel, block] as const));
    const recipes = new Map(overworldCraftingRecipes.map((recipe) => [recipe.id, recipe] as const));
    const resources = classicScenario.v2Equipment.resourceStrip;
    const recipeInputCount = (recipeId: string, itemId: string) => {
      const recipe = recipes.get(recipeId);
      if (!recipe) throw new Error(`Missing Classic recipe ${recipeId}.`);
      const inputs = recipe.kind === 'shaped' ? recipe.pattern.filter((stack) => stack !== null) : recipe.inputs;
      return inputs.reduce((total, stack) => total + (stack.itemId === itemId ? stack.count : 0), 0);
    };

    for (const resource of resources) {
      expect(items.get(resource.itemId)?.capabilities).toContainEqual({ type: 'place', voxel: resource.voxel });
      expect(blocks.get(resource.voxel)?.drop).toEqual({ itemId: resource.dropItemId, count: 1 });
    }
    expect(blocks.get(3)?.minimumTier).toBe(1);
    expect(blocks.get(21)?.minimumTier).toBe(2);
    expect(items.get('wood-pickaxe')?.capabilities).toContainEqual(
      expect.objectContaining({ type: 'mine', tool: 'pickaxe', tier: 1 }),
    );
    expect(items.get('stone-pickaxe')?.capabilities).toContainEqual(
      expect.objectContaining({ type: 'mine', tool: 'pickaxe', tier: 2 }),
    );
    expect(recipes.get('planks')).toMatchObject({
      inputs: [{ itemId: 'wood-block', count: 1 }],
      outputs: [{ itemId: 'plank', count: 4 }],
    });
    expect(recipes.get('sticks')).toMatchObject({
      outputs: [{ itemId: 'stick', count: 4 }],
    });
    expect(recipes.get('iron-block-unpack')).toMatchObject({
      inputs: [{ itemId: 'iron-block', count: 1 }],
      outputs: [{ itemId: 'iron-ingot', count: 9 }],
    });
    expect(recipeInputCount('wood-pickaxe', 'plank')).toBe(3);
    expect(recipeInputCount('wood-pickaxe', 'stick')).toBe(2);
    expect(recipeInputCount('stone-pickaxe', 'cobblestone')).toBe(3);
    expect(recipeInputCount('stone-pickaxe', 'stick')).toBe(2);
    const armorCosts = ['iron-helmet', 'iron-chestplate', 'iron-leggings', 'iron-boots', 'iron-helmet'].map((id) =>
      recipeInputCount(id, 'iron-ingot'),
    );
    expect(armorCosts).toEqual([5, 8, 7, 4, 5]);
    for (const [slot, itemId, points] of [
      ['helmet', 'iron-helmet', 2],
      ['chestplate', 'iron-chestplate', 6],
      ['leggings', 'iron-leggings', 5],
      ['boots', 'iron-boots', 2],
    ] as const) {
      expect(items.get(itemId)).toMatchObject({
        stackLimit: 1,
        durability: { max: 165 },
        capabilities: [{ type: 'armor', slot, points }],
      });
      expect(recipes.get(itemId)?.outputs).toEqual([{ itemId, count: 1, instance: { durability: 165 } }]);
    }
    expect(armorCosts.reduce((total, count) => total + count, 0)).toBeLessThanOrEqual(4 * 9);
    expect(
      3 * 4 - recipeInputCount('sticks', 'plank') - recipeInputCount('wood-pickaxe', 'plank'),
    ).toBeGreaterThanOrEqual(0);
    expect(4 * 9 - armorCosts.reduce((total, count) => total + count, 0)).toBe(7);
  });

  it('keeps post-baseline canonical actions on product input instead of Harness mutation ports', () => {
    const specSource = readFileSync(new URL('../classic-runtime.spec.ts', import.meta.url), 'utf8');
    const helperSource = readFileSync(new URL('./v1-slice.ts', import.meta.url), 'utf8');
    const equipmentSource = readFileSync(new URL('./equipment-journey.ts', import.meta.url), 'utf8');
    const equipmentSupportSource = readFileSync(new URL('./equipment-journey-support.ts', import.meta.url), 'utf8');
    const equipmentRouteSource = readFileSync(new URL('./equipment-resource-route.ts', import.meta.url), 'utf8');
    const baselineOffset = specSource.indexOf('const baseline = await waitForSnapshot');
    expect(baselineOffset).toBeGreaterThan(0);
    const productJourney = `${specSource.slice(baselineOffset)}\n${helperSource}\n${equipmentSource}\n${equipmentSupportSource}\n${equipmentRouteSource}`;
    for (const forbidden of [
      '.fillWorld(',
      '.setVoxelAt(',
      "type: 'teleport'",
      "type: 'give-item'",
      "type: 'add-item'",
      "type: 'despawn-entity'",
      "type: 'remove-item'",
      "type: 'apply-damage'",
      "type: 'spawn-creature'",
      '.world.clock(',
      '.invokeActorModuleOperation(',
      'clearNaturalFixtureEntities(',
    ])
      expect(productJourney, `post-baseline journey contains ${forbidden}`).not.toContain(forbidden);
  });

  it('keeps equipment placement, close settlement, and pre-save evidence on fresh runtime state', () => {
    const specSource = readFileSync(new URL('../classic-runtime.spec.ts', import.meta.url), 'utf8');
    const equipmentSource = readFileSync(new URL('./equipment-journey.ts', import.meta.url), 'utf8');
    const supportSource = readFileSync(new URL('./equipment-journey-support.ts', import.meta.url), 'utf8');
    const placement = supportSource.slice(
      supportSource.indexOf('async function placeResourceStrip'),
      supportSource.indexOf('async function mineResources'),
    );
    const walk = placement.indexOf('await walkEquipmentRoute(page, resource.approach)');
    const select = placement.indexOf('await selectCreativeItem(page, resource.itemId)');
    const placed = placement.indexOf('await expect.poll(() => voxelAt(page, resource.target)).toBe(resource.voxel)');
    const survival = placement.indexOf('await switchToSurvival(page)');
    const freshTick = placement.indexOf('value.authority.physicsTick > beforeSurvival.authority.physicsTick');
    const grounded = placement.indexOf('value.onGround && !value.colliding');
    expect([walk, select, placed, survival, freshTick, grounded].every((offset) => offset >= 0)).toBe(true);
    expect(walk).toBeLessThan(select);
    expect(select).toBeLessThan(placed);
    expect(placed).toBeLessThan(survival);
    expect(survival).toBeLessThan(freshTick);
    expect(survival).toBeLessThan(grounded);
    expect(placement).not.toContain('let selected');

    const closeSettlement = equipmentSource.slice(
      equipmentSource.indexOf('const beforeClose = current'),
      equipmentSource.indexOf("steps.push(equipmentStep('equipment-origin-close'"),
    );
    expect(closeSettlement).toContain('value.runtimeEpoch === beforeClose.runtimeEpoch');
    expect(closeSettlement).toContain('sameActor(value.actor, beforeClose.actor)');

    const preSave = specSource.slice(
      specSource.indexOf('const equipmentBeforeSave ='),
      specSource.indexOf('expect(observedVoxel(authorityBefore'),
    );
    expect(preSave).toContain('v2EquipmentPreSave: equipmentBeforeSave');
  });
});
