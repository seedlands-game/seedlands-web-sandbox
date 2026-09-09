import { Inventory, type InventorySlot } from '../inventory';
import type { ItemDefinitionRegistry, ItemStack } from '../item-registry';

export type StationGrid = readonly InventorySlot[];
export type ShapedStationRecipe = Readonly<{
  kind: 'shaped';
  id: string;
  pattern: readonly InventorySlot[];
  outputs: readonly Readonly<ItemStack>[];
}>;
export type ShapelessStationRecipe = Readonly<{
  kind: 'shapeless';
  id: string;
  inputs: readonly Readonly<ItemStack>[];
  outputs: readonly Readonly<ItemStack>[];
}>;
export type StationRecipe = ShapedStationRecipe | ShapelessStationRecipe;

export type StationCraftCandidate =
  | Readonly<{ success: true; grid: InventorySlot[]; output: InventorySlot[] }>
  | Readonly<{ success: false; reason: 'recipe-mismatch' | 'output-full' }>;

export type StationCandidateInput = Readonly<{
  grid: StationGrid;
  output: readonly InventorySlot[];
  recipe: StationRecipe;
  items: ItemDefinitionRegistry;
}>;

export function matchesShapedStationRecipe(
  grid: StationGrid,
  recipe: ShapedStationRecipe,
  items: ItemDefinitionRegistry,
): boolean {
  const candidate = validateGrid(grid, items);
  validateIdentity(recipe.id);
  if (!Array.isArray(recipe.pattern) || recipe.pattern.length !== 9)
    throw new TypeError('Shaped station pattern must be an exact 3x3 grid.');
  validateOutputs(recipe.outputs, items);
  recipe.pattern.forEach((ingredient) => {
    if (ingredient) items.assertStack(ingredient);
  });
  return recipe.pattern.every((ingredient, index) => {
    const slot = candidate[index];
    if (ingredient === null) return slot === null;
    return slot !== null && slot.itemId === ingredient.itemId && slot.count >= ingredient.count;
  });
}

export function matchesShapelessStationRecipe(
  grid: StationGrid,
  recipe: ShapelessStationRecipe,
  items: ItemDefinitionRegistry,
): boolean {
  const candidate = validateGrid(grid, items);
  validateIdentity(recipe.id);
  if (!Array.isArray(recipe.inputs) || recipe.inputs.length === 0)
    throw new TypeError('Shapeless station recipe inputs are required.');
  validateOutputs(recipe.outputs, items);
  const available = totals(candidate);
  const required = ingredientTotals(recipe.inputs, items);
  return [...required].every(([itemId, count]) => (available.get(itemId) ?? 0) >= count);
}

export function createStationCraftCandidate(input: StationCandidateInput): StationCraftCandidate {
  if (!Array.isArray(input.output) || input.output.length === 0)
    throw new TypeError('Station output inventory must have positive capacity.');
  const output = new Inventory(input.output.length, input.output, input.items);
  const matches =
    input.recipe.kind === 'shaped'
      ? matchesShapedStationRecipe(input.grid, input.recipe, input.items)
      : matchesShapelessStationRecipe(input.grid, input.recipe, input.items);
  if (!matches) return { success: false, reason: 'recipe-mismatch' };
  for (const stack of input.recipe.outputs) {
    if (!output.add(stack)) return { success: false, reason: 'output-full' };
  }
  const grid = validateGrid(input.grid, input.items);
  if (input.recipe.kind === 'shaped') consumeShaped(grid, input.recipe.pattern);
  else consumeShapeless(grid, input.recipe.inputs, input.items);
  return { success: true, grid, output: output.snapshot() };
}

function validateGrid(grid: StationGrid, items: ItemDefinitionRegistry): InventorySlot[] {
  if (!Array.isArray(grid) || grid.length !== 9) throw new TypeError('Station grid must be an exact 3x3 grid.');
  return new Inventory(9, grid, items).snapshot();
}

function validateIdentity(id: string): void {
  if (typeof id !== 'string' || !id.trim()) throw new TypeError('Station recipe identity is invalid.');
}

function validateOutputs(outputs: readonly Readonly<ItemStack>[], items: ItemDefinitionRegistry): void {
  if (!Array.isArray(outputs) || outputs.length === 0) throw new TypeError('Station recipe outputs are required.');
  outputs.forEach((stack) => items.assertStack(stack));
}

function totals(grid: StationGrid): Map<string, number> {
  const result = new Map<string, number>();
  for (const slot of grid) if (slot) result.set(slot.itemId, (result.get(slot.itemId) ?? 0) + slot.count);
  return result;
}

function ingredientTotals(inputs: readonly Readonly<ItemStack>[], items: ItemDefinitionRegistry): Map<string, number> {
  const result = new Map<string, number>();
  for (const stack of inputs) {
    items.assertStack(stack);
    result.set(stack.itemId, (result.get(stack.itemId) ?? 0) + stack.count);
  }
  return result;
}

function consumeShaped(grid: InventorySlot[], pattern: readonly InventorySlot[]): void {
  pattern.forEach((ingredient, index) => {
    if (!ingredient) return;
    const slot = grid[index]!;
    grid[index] = slot.count === ingredient.count ? null : { ...slot, count: slot.count - ingredient.count };
  });
}

function consumeShapeless(
  grid: InventorySlot[],
  inputs: readonly Readonly<ItemStack>[],
  items: ItemDefinitionRegistry,
): void {
  const required = ingredientTotals(inputs, items);
  for (let index = 0; index < grid.length; index += 1) {
    const slot = grid[index];
    if (!slot) continue;
    const remaining = required.get(slot.itemId) ?? 0;
    if (remaining === 0) continue;
    const consumed = Math.min(slot.count, remaining);
    required.set(slot.itemId, remaining - consumed);
    grid[index] = slot.count === consumed ? null : { ...slot, count: slot.count - consumed };
  }
}
