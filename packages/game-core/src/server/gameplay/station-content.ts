import { createStationStateCodec, type StationDefinition, type StationStateCodec } from './ecs-station-state';
import type { ItemDefinitionRegistry, ItemStack } from './item-registry';
import { createFurnaceDefinitions, type FurnaceFuel, type FurnaceRecipe } from './modules/furnace-candidates';
import type { StationRecipe } from './modules/station-candidates';

export type StationContentInput = Readonly<{
  definitions: readonly StationDefinition[];
  recipes: readonly StationRecipe[];
  furnaceRecipes: readonly FurnaceRecipe[];
  fuels: readonly FurnaceFuel[];
}>;
export type StationContent = Readonly<{
  codec: StationStateCodec;
  recipe(id: string): StationRecipe | undefined;
  listRecipes(): readonly StationRecipe[];
}>;

/** A world's immutable station content shares its exact item registry. */
export function createStationContent(input: StationContentInput, items: ItemDefinitionRegistry): StationContent {
  const stack = (raw: Readonly<ItemStack>) => Object.freeze(items.normalizeStack(raw));
  const recipes = new Map<string, StationRecipe>();
  for (const source of input.recipes) {
    if (!source.id?.trim() || recipes.has(source.id)) throw new TypeError('Duplicate or invalid station recipe ID.');
    if (!Array.isArray(source.outputs) || source.outputs.length === 0)
      throw new TypeError('Station recipe requires outputs.');
    const outputs = Object.freeze(source.outputs.map(stack));
    let recipe: StationRecipe;
    if (source.kind === 'shaped') {
      if (!Array.isArray(source.pattern) || source.pattern.length !== 9)
        throw new TypeError('Station pattern must have nine slots.');
      const pattern = Object.freeze(source.pattern.map((value) => (value === null ? null : stack(value))));
      if (!pattern.some(Boolean)) throw new TypeError('Station recipe requires ingredients.');
      recipe = Object.freeze({ kind: source.kind, id: source.id, pattern, outputs });
    } else if (source.kind === 'shapeless') {
      if (!Array.isArray(source.inputs) || source.inputs.length === 0)
        throw new TypeError('Station recipe requires ingredients.');
      recipe = Object.freeze({
        kind: source.kind,
        id: source.id,
        inputs: Object.freeze(source.inputs.map(stack)),
        outputs,
      });
    } else throw new TypeError('Invalid station recipe kind.');
    recipes.set(recipe.id, recipe);
  }
  const codec = createStationStateCodec({
    items,
    definitions: input.definitions,
    furnace: createFurnaceDefinitions({ items, recipes: input.furnaceRecipes, fuels: input.fuels }),
  });
  const values = Object.freeze([...recipes.values()]);
  return Object.freeze({ codec, recipe: (id: string) => recipes.get(id), listRecipes: () => values });
}
