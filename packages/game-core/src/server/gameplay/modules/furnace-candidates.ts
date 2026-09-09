import { Inventory, type InventorySlot } from '../inventory';
import type { ItemDefinitionRegistry, ItemStack } from '../item-registry';

export type FurnaceRecipe = Readonly<{
  id: string;
  input: Readonly<ItemStack>;
  output: Readonly<ItemStack>;
  durationSeconds: number;
}>;
export type FurnaceFuel = Readonly<{ itemId: string; burnSeconds: number }>;
export type FurnaceSnapshotV1 = Readonly<{
  version: 1;
  input: InventorySlot;
  fuel: InventorySlot;
  output: InventorySlot;
  activeRecipeId: string | null;
  remainingFuelSeconds: number;
  progressSeconds: number;
}>;

export type FurnaceDefinitions = Readonly<{
  items: ItemDefinitionRegistry;
  recipe: (id: string) => FurnaceRecipe | undefined;
  recipeForInput: (itemId: string) => FurnaceRecipe | undefined;
  fuel: (itemId: string) => FurnaceFuel | undefined;
  listRecipes: () => readonly FurnaceRecipe[];
  listFuels: () => readonly FurnaceFuel[];
}>;

export type FurnaceDefinitionInput = Readonly<{
  items: ItemDefinitionRegistry;
  recipes: readonly FurnaceRecipe[];
  fuels: readonly FurnaceFuel[];
}>;

export type FurnaceAdvanceCandidate = Readonly<{
  snapshot: FurnaceSnapshotV1;
  completedRecipeIds: readonly string[];
}>;

export function createFurnaceDefinitions(input: FurnaceDefinitionInput): FurnaceDefinitions {
  const recipes = new Map<string, FurnaceRecipe>();
  const recipesByInput = new Map<string, FurnaceRecipe>();
  for (const source of input.recipes) {
    if (!source.id?.trim() || recipes.has(source.id))
      throw new TypeError(`Duplicate or empty furnace recipe: ${source.id}`);
    validateSingleSlotStack(source.input, input.items, 'Furnace recipe input');
    validateSingleSlotStack(source.output, input.items, 'Furnace recipe output');
    const durationSeconds = logicalDuration(source.durationSeconds, 'Furnace recipe duration');
    if (recipesByInput.has(source.input.itemId))
      throw new TypeError(`Duplicate furnace recipe input: ${source.input.itemId}`);
    const recipe = Object.freeze({
      id: source.id,
      input: Object.freeze({ ...source.input }),
      output: Object.freeze({ ...source.output }),
      durationSeconds,
    });
    recipes.set(recipe.id, recipe);
    recipesByInput.set(recipe.input.itemId, recipe);
  }
  const fuels = new Map<string, FurnaceFuel>();
  for (const source of input.fuels) {
    input.items.require(source.itemId);
    if (fuels.has(source.itemId)) throw new TypeError(`Duplicate furnace fuel: ${source.itemId}`);
    fuels.set(
      source.itemId,
      Object.freeze({
        itemId: source.itemId,
        burnSeconds: logicalDuration(source.burnSeconds, 'Furnace fuel duration'),
      }),
    );
  }
  const recipeValues = Object.freeze([...recipes.values()]);
  const fuelValues = Object.freeze([...fuels.values()]);
  return Object.freeze({
    items: input.items,
    recipe: (id: string) => recipes.get(id),
    recipeForInput: (itemId: string) => recipesByInput.get(itemId),
    fuel: (itemId: string) => fuels.get(itemId),
    listRecipes: () => recipeValues,
    listFuels: () => fuelValues,
  });
}

export const emptyFurnaceSnapshot = (): FurnaceSnapshotV1 => ({
  version: 1,
  input: null,
  fuel: null,
  output: null,
  activeRecipeId: null,
  remainingFuelSeconds: 0,
  progressSeconds: 0,
});

export function validateFurnaceSnapshot(raw: unknown, definitions: FurnaceDefinitions): FurnaceSnapshotV1 {
  const source = raw as Partial<FurnaceSnapshotV1> | null;
  if (!source || source.version !== 1) throw new TypeError('Furnace snapshot version is invalid.');
  const input = validateSlot(source.input, definitions.items, 'input');
  const fuel = validateSlot(source.fuel, definitions.items, 'fuel');
  const output = validateSlot(source.output, definitions.items, 'output');
  if (fuel && !definitions.fuel(fuel.itemId)) throw new TypeError(`Unknown furnace fuel: ${fuel.itemId}`);
  if (!finiteNonNegative(source.remainingFuelSeconds) || !finiteNonNegative(source.progressSeconds))
    throw new TypeError('Furnace snapshot time is invalid.');
  if (source.activeRecipeId !== null && typeof source.activeRecipeId !== 'string')
    throw new TypeError('Furnace active recipe identity is invalid.');
  const active = source.activeRecipeId === null ? null : definitions.recipe(source.activeRecipeId);
  if (source.activeRecipeId !== null && !active)
    throw new TypeError(`Unknown furnace active recipe: ${source.activeRecipeId}`);
  if (active && (!input || input.itemId !== active.input.itemId || input.count < active.input.count))
    throw new TypeError('Furnace active recipe does not match its input.');
  if (active && round(source.progressSeconds!) >= active.durationSeconds)
    throw new TypeError('Furnace progress exceeds its active recipe duration.');
  if (!active && source.progressSeconds !== 0) throw new TypeError('Furnace progress requires an active recipe.');
  return {
    version: 1,
    input,
    fuel,
    output,
    activeRecipeId: active?.id ?? null,
    remainingFuelSeconds: round(source.remainingFuelSeconds!),
    progressSeconds: round(source.progressSeconds!),
  };
}

export function advanceFurnaceCandidate(
  raw: unknown,
  logicalSeconds: number,
  definitions: FurnaceDefinitions,
): FurnaceAdvanceCandidate {
  if (!finiteNonNegative(logicalSeconds))
    throw new TypeError('Furnace logical seconds must be non-negative and finite.');
  const decoded = validateFurnaceSnapshot(raw, definitions);
  const state = { ...decoded };
  const completed: string[] = [];
  let remaining = round(logicalSeconds);
  let transitions = 0;
  while (transitions++ < 512) {
    const recipe = state.input ? definitions.recipeForInput(state.input.itemId) : undefined;
    if (!recipe || state.input!.count < recipe.input.count) {
      state.activeRecipeId = null;
      state.progressSeconds = 0;
      break;
    }
    if (!canAcceptOutput(state.output, recipe.output, definitions.items)) break;
    if (remaining === 0) break;
    if (state.remainingFuelSeconds === 0) {
      const fuel = state.fuel ? definitions.fuel(state.fuel.itemId) : undefined;
      if (!fuel) break;
      state.fuel = decrement(state.fuel!, 1);
      state.remainingFuelSeconds = fuel.burnSeconds;
    }
    state.activeRecipeId = recipe.id;
    const advanced = Math.min(remaining, state.remainingFuelSeconds, recipe.durationSeconds - state.progressSeconds);
    if (advanced <= 0) break;
    remaining = round(remaining - advanced);
    state.remainingFuelSeconds = round(state.remainingFuelSeconds - advanced);
    state.progressSeconds = round(state.progressSeconds + advanced);
    if (state.progressSeconds < recipe.durationSeconds) continue;
    state.input = decrement(state.input!, recipe.input.count);
    state.output = increment(state.output, recipe.output);
    state.activeRecipeId = null;
    state.progressSeconds = 0;
    completed.push(recipe.id);
  }
  if (transitions >= 512) throw new Error('Furnace candidate transition limit exceeded.');
  return { snapshot: validateFurnaceSnapshot(state, definitions), completedRecipeIds: Object.freeze(completed) };
}

function validateSlot(value: unknown, items: ItemDefinitionRegistry, label: string): InventorySlot {
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw new TypeError(`Furnace ${label} slot is invalid.`);
  try {
    return new Inventory(1, [value as ItemStack], items).slot(0);
  } catch (error) {
    throw new TypeError(`Furnace ${label} slot is invalid: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

function validateSingleSlotStack(stack: Readonly<ItemStack>, items: ItemDefinitionRegistry, label: string): void {
  try {
    new Inventory(1, [stack], items);
  } catch (error) {
    throw new TypeError(`${label} is invalid: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

function logicalDuration(value: number, label: string): number {
  if (!finiteNonNegative(value) || value <= 0) throw new TypeError(`${label} must be positive and finite.`);
  const duration = round(value);
  if (duration === 0) throw new TypeError(`${label} is below logical time precision.`);
  return duration;
}

const finiteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER / 1_000_000;
const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

function canAcceptOutput(output: InventorySlot, added: Readonly<ItemStack>, items: ItemDefinitionRegistry): boolean {
  return (
    output === null ||
    (output.itemId === added.itemId && output.count + added.count <= items.require(added.itemId).stackLimit)
  );
}

function decrement(stack: ItemStack, count: number): InventorySlot {
  return stack.count === count ? null : { ...stack, count: stack.count - count };
}

function increment(output: InventorySlot, added: Readonly<ItemStack>): ItemStack {
  return output ? { ...output, count: output.count + added.count } : { ...added };
}
