export type PersonalRecipe = Readonly<{
  id: string;
  name: string;
  requirements: string;
  result: string;
  craftable: boolean;
}>;

const classicStarterPath = [
  'planks',
  'sticks',
  'wood-pickaxe',
  'wood-axe',
  'wood-sword',
  'workbench',
  'torch',
  'stone-pickaxe',
] as const;

const classicStarterRank = new Map<string, number>(
  classicStarterPath.map((id, index): [string, number] => [id, index]),
);

function progressionRank(recipe: PersonalRecipe): number {
  return classicStarterRank.get(recipe.id) ?? classicStarterPath.length;
}

/**
 * Keep the early hand-crafting path visible before unrelated conversions.
 * Pack recipes retain a deterministic fallback order without deriving meaning from localized names.
 */
export function orderPersonalRecipes(recipes: readonly PersonalRecipe[]): PersonalRecipe[] {
  return [...recipes].sort(
    (left, right) =>
      Number(right.craftable) - Number(left.craftable) ||
      progressionRank(left) - progressionRank(right) ||
      (left.id === right.id ? 0 : left.id < right.id ? -1 : 1),
  );
}
