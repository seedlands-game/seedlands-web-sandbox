import type { ModItemDefinition, ModModule, ModRecipeDefinition } from '../../composition/contracts';
import { createGameplayContent, type GameplayContent } from '../gameplay-content';
import type { ItemDefinitionRegistry, ItemStack } from '../item-registry';
import type { MeleeDefinition } from '../combat-runtime';

export function defineContentModule(
  input: Readonly<{
    moduleId: string;
    items: readonly ModItemDefinition[];
    recipes?: readonly ModRecipeDefinition[];
    meleeDefinitions: readonly MeleeDefinition[];
  }>,
): ModModule {
  return Object.freeze({
    descriptor: {
      id: input.moduleId,
      version: '1.0.0',
      provides: [
        { id: 'seedlands:items', version: '1.0.0' },
        { id: 'seedlands:gameplay-content', version: '1.0.0' },
      ],
    },
    register(api) {
      input.items.forEach(api.registerItem);
      (input.recipes ?? []).forEach(api.registerRecipe);
      let content: GameplayContent | undefined;
      const resolve = () => {
        if (content) return content;
        const definitions = api.readContentDefinitions();
        const storage = new Map(definitions.items.map((item) => [item.id, item.storageId ?? item.id]));
        const stacks = (entries: readonly Readonly<ItemStack>[]) =>
          entries.map((entry) => {
            const itemId = storage.get(entry.itemId);
            if (!itemId) throw new TypeError(`Recipe references unknown item: ${entry.itemId}`);
            return { itemId, count: entry.count };
          });
        content = createGameplayContent({
          items: definitions.items.map((item) => ({
            id: item.storageId ?? item.id,
            name: item.name,
            stackLimit: item.stackLimit,
            itemType: item.itemType ?? 'resource',
            ...(item.durability ? { durability: item.durability } : {}),
            capabilities: item.capabilities ?? [],
          })),
          recipes: definitions.recipes.map((recipe) => ({
            id: recipe.storageId ?? recipe.id,
            inputs: stacks(recipe.inputs),
            outputs: stacks(recipe.outputs),
          })),
          meleeDefinitions: input.meleeDefinitions,
        });
        return content;
      };
      const items: ItemDefinitionRegistry = Object.freeze({
        get: (id: string) => resolve().items.get(id),
        require: (id: string) => resolve().items.require(id),
        has: (id: string) => resolve().items.has(id),
        list: () => resolve().items.list(),
        capability: (id, type) => resolve().items.capability(id, type),
        normalizeStack: (value, options) => resolve().items.normalizeStack(value, options),
        assertStack: (stack: { itemId: string; count: number }): asserts stack is ItemStack =>
          resolve().items.assertStack(stack),
      });
      api.provideCapability('seedlands:items', items);
      api.provideCapability('seedlands:gameplay-content', Object.freeze({ resolve }));
      api.onDefinitionsReady(() => {
        resolve();
      });
    },
  } satisfies ModModule);
}
