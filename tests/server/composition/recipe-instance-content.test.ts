import { describe, expect, it } from 'vitest';
import { defineContentModule, definePack, type ModItemAmount, type ModModule } from '@seedlands/game-core/mod-api';
import { assembleWorldPacks, gameplayContentForComposition } from '@seedlands/game-core/server/composition/host-api';
import { Inventory } from '../../../packages/game-core/src/server/gameplay/inventory';
import { createItemDefinitionRegistry } from '../../../packages/game-core/src/server/gameplay/item-registry';
import { craftRecipe, createRecipeRegistry } from '../../../packages/game-core/src/server/gameplay/recipe-registry';

const integrity = Object.freeze({
  algorithm: 'sha256' as const,
  manifestDigest: 'a'.repeat(64),
  entryDigest: 'b'.repeat(64),
  resources: Object.freeze([]),
});

function assemble(modules: readonly ModModule[]) {
  const pack = definePack({
    id: 'test:recipe-instances',
    kind: 'playbook',
    version: '1.0.0',
    modules,
  });
  return assembleWorldPacks([{ ...pack, integrity }]);
}

const contentModule = (output: ModItemAmount) =>
  defineContentModule({
    moduleId: 'test:content',
    items: [
      {
        id: 'test:ore',
        storageId: 'stored-ore',
        name: 'Ore',
        itemType: 'resource',
        stackLimit: 64,
        capabilities: [],
      },
      {
        id: 'test:custom-tool',
        storageId: 'stored-custom-tool',
        name: 'Custom Tool',
        itemType: 'tool',
        stackLimit: 1,
        durability: { max: 9 },
        capabilities: [],
      },
    ],
    recipes: [
      {
        id: 'test:craft-custom-tool',
        storageId: 'stored-craft-custom-tool',
        inputs: [{ itemId: 'test:ore', count: 2 }],
        outputs: [output],
      },
    ],
    meleeDefinitions: [],
  });

describe('recipe item instances through public content registration', () => {
  it('maps storage IDs and crafts the exact detached durable output', () => {
    const sourceInstance = { durability: 7 };
    const sourceOutput = {
      itemId: 'test:custom-tool',
      count: 1,
      instance: sourceInstance,
    };
    const composition = assemble([contentModule(sourceOutput)]);
    const content = gameplayContentForComposition(composition);
    sourceInstance.durability = 1;

    expect(composition.registrations.recipes[0]?.outputs[0]).toEqual({
      itemId: 'test:custom-tool',
      count: 1,
      instance: { durability: 7 },
    });
    expect(content.recipes.get('stored-craft-custom-tool')?.outputs[0]).toEqual({
      itemId: 'stored-custom-tool',
      count: 1,
      instance: { durability: 7 },
    });
    expect(Object.isFrozen(composition.registrations.recipes[0]?.outputs[0]?.instance)).toBe(true);
    expect(Object.isFrozen(content.recipes.get('stored-craft-custom-tool')?.outputs[0]?.instance)).toBe(true);

    const inventory = new Inventory(2, [{ itemId: 'stored-ore', count: 2 }, null], content.items);
    expect(craftRecipe(inventory, 'stored-craft-custom-tool', content.recipes)).toMatchObject({ success: true });
    expect(inventory.snapshot()).toEqual([
      { itemId: 'stored-custom-tool', count: 1, instance: { durability: 7 } },
      null,
    ]);
    expect(sourceOutput.instance.durability).toBe(1);
  });

  it.each([
    {
      label: 'missing durable output instance',
      output: { itemId: 'test:custom-tool', count: 1 },
    },
    {
      label: 'over-max durable output instance',
      output: { itemId: 'test:custom-tool', count: 1, instance: { durability: 10 } },
    },
    {
      label: 'non-durable output instance',
      output: { itemId: 'test:ore', count: 1, instance: { durability: 1 } },
    },
    {
      label: 'invalid output count',
      output: { itemId: 'test:custom-tool', count: 0, instance: { durability: 7 } },
    },
  ])('rejects $label before assembly returns', ({ output }) => {
    expect(() => assemble([contentModule(output)])).toThrow(/instance|durability|count/i);
  });

  it('does not initialize a missing durable recipe input at max', () => {
    const module = defineContentModule({
      moduleId: 'test:content',
      items: [
        {
          id: 'test:tool',
          name: 'Tool',
          itemType: 'tool',
          stackLimit: 1,
          durability: { max: 5 },
          capabilities: [],
        },
        {
          id: 'test:scrap',
          name: 'Scrap',
          itemType: 'resource',
          stackLimit: 64,
          capabilities: [],
        },
      ],
      recipes: [
        {
          id: 'test:salvage',
          inputs: [{ itemId: 'test:tool', count: 1 }],
          outputs: [{ itemId: 'test:scrap', count: 1 }],
        },
      ],
      meleeDefinitions: [],
    });

    expect(() => assemble([module])).toThrow(/instance|durability/i);
  });
});

describe('per-world recipe registry instance snapshots', () => {
  it('normalizes and deep-freezes nested instances without retaining source aliases', () => {
    const items = createItemDefinitionRegistry([
      {
        id: 'test:ore',
        name: 'Ore',
        itemType: 'resource',
        stackLimit: 64,
        capabilities: [],
      },
      {
        id: 'test:tool',
        name: 'Tool',
        itemType: 'tool',
        stackLimit: 1,
        durability: { max: 8 },
        capabilities: [],
      },
    ]);
    const sourceInstance = { durability: 6 };
    const registry = createRecipeRegistry(
      [
        {
          id: 'test:tool-recipe',
          inputs: [{ itemId: 'test:ore', count: 1 }],
          outputs: [{ itemId: 'test:tool', count: 1, instance: sourceInstance }],
        },
      ],
      items,
    );
    sourceInstance.durability = 2;

    const output = registry.get('test:tool-recipe')?.outputs[0];
    expect(output).toEqual({ itemId: 'test:tool', count: 1, instance: { durability: 6 } });
    expect(output?.instance).not.toBe(sourceInstance);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output?.instance)).toBe(true);
  });
});
