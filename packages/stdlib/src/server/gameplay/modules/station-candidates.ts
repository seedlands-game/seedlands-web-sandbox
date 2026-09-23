import { sameItemStackIdentity } from '../item-instance';
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

const gridWidth = (grid: readonly unknown[]): 2 | 3 => {
  if (grid.length === 4) return 2;
  if (grid.length === 9) return 3;
  throw new TypeError('Crafting grid must be an exact 2x2 or 3x3 grid.');
};

const shapedBounds = (pattern: readonly InventorySlot[]) => {
  if (!Array.isArray(pattern) || pattern.length !== 9)
    throw new TypeError('Shaped recipe pattern must be an exact 3x3 grid.');
  const occupied = pattern.flatMap((slot, index) => (slot ? [[index % 3, Math.floor(index / 3)] as const] : []));
  if (!occupied.length) throw new TypeError('Shaped recipe requires ingredients.');
  const xs = occupied.map(([x]) => x),
    ys = occupied.map(([, y]) => y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs) + 1,
    height: Math.max(...ys) - Math.min(...ys) + 1,
  };
};

export function stationRecipeFitsGrid(recipe: StationRecipe, size: 2 | 3): boolean {
  if (recipe.kind === 'shapeless') return recipe.inputs.length <= size * size;
  const bounds = shapedBounds(recipe.pattern);
  return bounds.width <= size && bounds.height <= size;
}

export function matchesShapedStationRecipe(
  grid: StationGrid,
  recipe: ShapedStationRecipe,
  items: ItemDefinitionRegistry,
): boolean {
  const candidate = validateGrid(grid, items);
  const width = gridWidth(candidate);
  validateIdentity(recipe.id);
  const bounds = shapedBounds(recipe.pattern);
  validateOutputs(recipe.outputs, items);
  recipe.pattern.forEach((ingredient) => {
    if (ingredient) items.assertStack(ingredient);
  });
  if (bounds.width > width || bounds.height > width) return false;
  for (let offsetY = 0; offsetY <= width - bounds.height; offsetY += 1)
    for (let offsetX = 0; offsetX <= width - bounds.width; offsetX += 1) {
      const expected: InventorySlot[] = Array.from({ length: candidate.length }, () => null);
      recipe.pattern.forEach((ingredient, index) => {
        if (!ingredient) return;
        const x = (index % 3) - bounds.left + offsetX;
        const y = Math.floor(index / 3) - bounds.top + offsetY;
        expected[y * width + x] = ingredient;
      });
      if (
        expected.every((ingredient, index) =>
          ingredient === null
            ? candidate[index] === null
            : candidate[index] !== null &&
              sameItemStackIdentity(candidate[index]!, ingredient) &&
              candidate[index]!.count >= ingredient.count,
        )
      )
        return true;
    }
  return false;
}

export function matchesShapelessStationRecipe(
  grid: StationGrid,
  recipe: ShapelessStationRecipe,
  items: ItemDefinitionRegistry,
): boolean {
  const candidate = validateGrid(grid, items);
  const width = gridWidth(candidate);
  validateIdentity(recipe.id);
  if (!Array.isArray(recipe.inputs) || recipe.inputs.length === 0)
    throw new TypeError('Shapeless station recipe inputs are required.');
  validateOutputs(recipe.outputs, items);
  recipe.inputs.forEach((input) => items.assertStack(input));
  if (!stationRecipeFitsGrid(recipe, width)) return false;
  return matchShapelessSlots(candidate, recipe.inputs) !== null;
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
  else consumeShapeless(grid, input.recipe.inputs);
  return { success: true, grid, output: output.snapshot() };
}

function validateGrid(grid: StationGrid, items: ItemDefinitionRegistry): InventorySlot[] {
  if (!Array.isArray(grid)) throw new TypeError('Crafting grid must be an array.');
  gridWidth(grid);
  return new Inventory(grid.length, grid, items).snapshot();
}

function validateIdentity(id: string): void {
  if (typeof id !== 'string' || !id.trim()) throw new TypeError('Station recipe identity is invalid.');
}

function validateOutputs(outputs: readonly Readonly<ItemStack>[], items: ItemDefinitionRegistry): void {
  if (!Array.isArray(outputs) || outputs.length === 0) throw new TypeError('Station recipe outputs are required.');
  outputs.forEach((stack) => items.assertStack(stack));
}

function consumeShaped(grid: InventorySlot[], pattern: readonly InventorySlot[]): void {
  const width = gridWidth(grid),
    bounds = shapedBounds(pattern);
  for (let offsetY = 0; offsetY <= width - bounds.height; offsetY += 1)
    for (let offsetX = 0; offsetX <= width - bounds.width; offsetX += 1) {
      const indices: Array<[number, NonNullable<InventorySlot>]> = [];
      pattern.forEach((ingredient, index) => {
        if (!ingredient) return;
        const x = (index % 3) - bounds.left + offsetX;
        const y = Math.floor(index / 3) - bounds.top + offsetY;
        indices.push([y * width + x, ingredient]);
      });
      if (
        !indices.every(
          ([index, ingredient]) =>
            grid[index] && sameItemStackIdentity(grid[index]!, ingredient) && grid[index]!.count >= ingredient.count,
        )
      )
        continue;
      indices.forEach(([index, ingredient]) => {
        const slot = grid[index]!;
        grid[index] = slot.count === ingredient.count ? null : { ...slot, count: slot.count - ingredient.count };
      });
      return;
    }
}

function matchShapelessSlots(
  grid: readonly InventorySlot[],
  inputs: readonly Readonly<ItemStack>[],
): readonly Readonly<{ slot: number; ingredient: Readonly<ItemStack> }>[] | null {
  const occupied = grid.flatMap((stack, slot) => (stack ? [{ slot, stack }] : []));
  if (occupied.length !== inputs.length) return null;
  const search = (
    index: number,
    remaining: readonly Readonly<ItemStack>[],
    matches: readonly Readonly<{ slot: number; ingredient: Readonly<ItemStack> }>[],
  ): readonly Readonly<{ slot: number; ingredient: Readonly<ItemStack> }>[] | null => {
    if (index === occupied.length) return matches;
    const entry = occupied[index];
    for (let ingredientIndex = 0; ingredientIndex < remaining.length; ingredientIndex += 1) {
      const ingredient = remaining[ingredientIndex];
      if (!sameItemStackIdentity(entry.stack, ingredient) || entry.stack.count < ingredient.count) continue;
      const result = search(
        index + 1,
        [...remaining.slice(0, ingredientIndex), ...remaining.slice(ingredientIndex + 1)],
        [...matches, { slot: entry.slot, ingredient }],
      );
      if (result) return result;
    }
    return null;
  };
  return search(0, inputs, []);
}

function consumeShapeless(grid: InventorySlot[], inputs: readonly Readonly<ItemStack>[]): void {
  const matches = matchShapelessSlots(grid, inputs);
  if (!matches) throw new Error('Shapeless recipe consumption requires a matched grid.');
  for (const { slot: index, ingredient } of matches) {
    const stack = grid[index]!;
    grid[index] = stack.count === ingredient.count ? null : { ...stack, count: stack.count - ingredient.count };
  }
}
