import { Inventory, type InventoryAccess, type InventorySlot } from '../inventory';
import { sameItemStackIdentity } from '../item-instance';
import type { Recipe, RecipeRegistry } from '../recipe-registry';

export const CRAFTING_CAPABILITY = 'seedlands:crafting-match';
export type CraftingConsumptionV1 = Readonly<{ slot: number; count: number }>;
export type CraftingMatchRequestV1 = Readonly<{
  recipe: Recipe;
  slots: readonly InventorySlot[];
  selectedSlot: number;
}>;
export type CraftingProviderV1 = Readonly<{
  version: 1;
  match(request: CraftingMatchRequestV1): readonly CraftingConsumptionV1[] | null;
}>;

export function freezeCraftingProvider(value: CraftingProviderV1): CraftingProviderV1 {
  if (!value || value.version !== 1 || typeof value.match !== 'function')
    throw new TypeError('Invalid crafting provider version or matcher.');
  const match = value.match;
  return Object.freeze({ version: 1, match: (request: CraftingMatchRequestV1) => match(request) });
}

export const shapelessCraftingProvider = freezeCraftingProvider({
  version: 1,
  match({ recipe, slots }) {
    const result: CraftingConsumptionV1[] = [];
    for (const input of recipe.inputs) {
      let remaining = input.count;
      for (let slot = 0; slot < slots.length && remaining; slot++) {
        const stack = slots[slot];
        if (!stack || !sameItemStackIdentity(stack, input)) continue;
        const count = Math.min(remaining, stack.count);
        result.push({ slot, count });
        remaining -= count;
      }
      if (remaining) return null;
    }
    return result;
  },
});

type CraftingMatch =
  | Readonly<{ success: true; recipe: Recipe; plan: readonly CraftingConsumptionV1[] }>
  | Readonly<{ success: false; reason: string }>;

function frozenSlots(slots: readonly InventorySlot[]): readonly InventorySlot[] {
  return Object.freeze(
    slots.map((stack) =>
      stack
        ? Object.freeze({
            ...stack,
            ...(stack.instance ? { instance: Object.freeze({ ...stack.instance }) } : {}),
          })
        : null,
    ),
  );
}

function matchCraftingPlan(
  slots: readonly InventorySlot[],
  recipeId: string,
  registry: RecipeRegistry,
  provider: CraftingProviderV1 | null,
  selectedSlot: number,
): CraftingMatch {
  if (!provider) return { success: false, reason: 'crafting-unavailable' };
  const recipe = registry.get(recipeId);
  if (!recipe) return { success: false, reason: 'unknown-recipe' };
  if (!Number.isSafeInteger(selectedSlot) || selectedSlot < 0 || selectedSlot >= slots.length)
    throw new RangeError('Crafting selected slot is out of range.');
  const plan = provider.match(Object.freeze({ recipe, slots, selectedSlot }));
  if (plan === null) return { success: false, reason: 'missing-inputs' };
  if (!Array.isArray(plan) || !plan.length || plan.length > slots.length)
    throw new TypeError('Invalid crafting consumption plan.');
  const used = new Set<number>(),
    consumed = recipe.inputs.map(() => 0);
  for (const entry of plan) {
    if (
      !entry ||
      !Number.isSafeInteger(entry.slot) ||
      entry.slot < 0 ||
      entry.slot >= slots.length ||
      !Number.isSafeInteger(entry.count) ||
      entry.count <= 0 ||
      used.has(entry.slot)
    )
      throw new TypeError('Invalid or duplicate crafting consumption slot.');
    used.add(entry.slot);
    const stack = slots[entry.slot];
    const index = stack ? recipe.inputs.findIndex((input) => sameItemStackIdentity(input, stack)) : -1;
    if (!stack || index < 0 || entry.count > stack.count)
      throw new TypeError('Crafting consumption does not match its observed input.');
    consumed[index] += entry.count;
    if (consumed[index] > recipe.inputs[index].count)
      throw new TypeError('Crafting consumption exceeds its recipe input.');
  }
  if (consumed.some((count, index) => count !== recipe.inputs[index].count))
    throw new TypeError('Crafting consumption omits required input.');
  return { success: true, recipe, plan };
}

function hasOutputCapacity(
  slots: readonly InventorySlot[],
  plan: readonly CraftingConsumptionV1[],
  recipe: Recipe,
  registry: RecipeRegistry,
): boolean {
  const candidate = new Inventory(slots.length, slots, registry.items);
  for (const entry of plan)
    if (!candidate.removeFromSlot(entry.slot, entry.count))
      throw new TypeError('Crafting consumption exceeds its recipe input.');
  for (const output of recipe.outputs) if (!candidate.add(output)) return false;
  return true;
}

/** Checks whether the full crafting transaction can succeed without allocating its resulting inventory projection. */
export function isCraftingMatchEligible(
  slots: readonly InventorySlot[],
  recipeId: string,
  registry: RecipeRegistry,
  provider: CraftingProviderV1 | null,
  selectedSlot: number,
): boolean {
  const detachedSlots = frozenSlots(slots);
  const match = matchCraftingPlan(detachedSlots, recipeId, registry, provider, selectedSlot);
  return match.success && hasOutputCapacity(detachedSlots, match.plan, match.recipe, registry);
}

/** A matcher only proposes consumption; this owner validates and commits the complete transaction. */
export function applyCraftingMatch(
  inventory: InventoryAccess,
  recipeId: string,
  registry: RecipeRegistry,
  provider: CraftingProviderV1 | null,
  selectedSlot: number,
): { success: true; recipe: Recipe } | { success: false; reason: string } {
  if (inventory.items !== registry.items) throw new TypeError('Crafting content registries do not match.');
  const slots = frozenSlots(inventory.snapshot());
  const match = matchCraftingPlan(slots, recipeId, registry, provider, selectedSlot);
  if (!match.success) return match;
  const candidate = new Inventory(inventory.capacity, slots, inventory.items);
  for (const entry of match.plan)
    if (!candidate.removeFromSlot(entry.slot, entry.count))
      throw new TypeError('Crafting consumption exceeds its recipe input.');
  for (const output of match.recipe.outputs) {
    if (!candidate.add(output)) return { success: false, reason: 'no-output-capacity' };
  }
  inventory.replace(candidate.snapshot());
  return { success: true, recipe: match.recipe };
}
