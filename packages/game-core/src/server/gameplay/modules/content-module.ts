import { CRAFTING_CAPABILITY, freezeCraftingProvider, type CraftingProviderV1 } from './crafting-provider';
import type { StationContentInput } from '../station-content';
import type { ModItemDefinition, ModModule, ModRecipeDefinition } from '../../composition/contracts';
import { createGameplayContent, type GameplayContent } from '../gameplay-content';
import type { ItemDefinitionRegistry, ItemStack } from '../item-registry';
import type { MeleeDefinition } from '../combat-runtime';
import type { ActorProfileInput, StarterEcologyConfigurationInput } from '../actor-profile';

export function defineContentModule(
  input: Readonly<{
    moduleId: string;
    items: readonly ModItemDefinition[];
    recipes?: readonly ModRecipeDefinition[];
    craftingProvider?: boolean;
    stations?: StationContentInput;
    meleeDefinitions: readonly MeleeDefinition[];
    actorProfiles?: readonly ActorProfileInput[];
    defaultPlayerMeleeDefinitionId?: string;
    starterEcology?: StarterEcologyConfigurationInput;
  }>,
): ModModule {
  return Object.freeze({
    descriptor: {
      id: input.moduleId,
      version: '1.0.0',
      requires: input.craftingProvider ? [{ id: CRAFTING_CAPABILITY, version: '1.0.0' }] : [],
      provides: [
        { id: 'seedlands:items', version: '1.0.0' },
        { id: 'seedlands:gameplay-content', version: '1.0.0' },
        { id: 'seedlands:actor-profiles', version: '1.0.0' },
      ],
    },
    register(api) {
      const crafting = input.craftingProvider
        ? freezeCraftingProvider(api.requireCapability<CraftingProviderV1>(CRAFTING_CAPABILITY))
        : null;
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
            return {
              itemId,
              count: entry.count,
              ...(entry.instance !== undefined ? { instance: { ...entry.instance } } : {}),
            };
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
          crafting,
          actorProfiles: (input.actorProfiles ?? []).map((profile) => ({
            ...profile,
            ...(profile.deathDrop ? { deathDrop: stacks([profile.deathDrop])[0]! } : {}),
          })),
          ...(input.defaultPlayerMeleeDefinitionId
            ? { defaultPlayerMeleeDefinitionId: input.defaultPlayerMeleeDefinitionId }
            : {}),
          ...(input.starterEcology
            ? {
                starterEcology: {
                  ...input.starterEcology,
                  initialItem: stacks([input.starterEcology.initialItem])[0]!,
                },
              }
            : {}),
          ...(input.stations
            ? {
                stations: {
                  definitions: input.stations.definitions,
                  recipes: input.stations.recipes.map((recipe) =>
                    recipe.kind === 'shaped'
                      ? {
                          ...recipe,
                          pattern: recipe.pattern.map((value) => (value === null ? null : stacks([value])[0]!)),
                          outputs: stacks(recipe.outputs),
                        }
                      : { ...recipe, inputs: stacks(recipe.inputs), outputs: stacks(recipe.outputs) },
                  ),
                  furnaceRecipes: input.stations.furnaceRecipes.map((recipe) => ({
                    ...recipe,
                    input: stacks([recipe.input])[0]!,
                    output: stacks([recipe.output])[0]!,
                  })),
                  fuels: input.stations.fuels.map((fuel) => ({
                    ...fuel,
                    itemId: stacks([{ itemId: fuel.itemId, count: 1 }])[0]!.itemId,
                  })),
                },
              }
            : {}),
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
      api.provideCapability('seedlands:actor-profiles', Object.freeze({ resolve: () => resolve().actorProfiles }));
      api.onDefinitionsReady(() => {
        resolve();
      });
    },
  } satisfies ModModule);
}
