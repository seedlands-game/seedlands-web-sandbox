import { getItemDefinition } from '../../server/gameplay/item-registry';
import { listRecipes } from '../../server/gameplay/recipe-registry';

export type GameplayItemPresentation = Readonly<{
  slot: number;
  itemId: string | null;
  count: number;
  name: string;
  edible: boolean;
}>;

export type GameplayUiSource = Readonly<{
  revision: number;
  player: Readonly<{
    lifecycle: 'alive' | 'dead';
    health: number;
    hunger: number;
    selectedHotbarSlot: number;
    inventory: readonly (Readonly<{ itemId: string; count: number }> | null)[];
  }>;
  inventoryOpen: boolean;
  craftableRecipeIds: readonly string[];
  target: Readonly<{ kind: 'voxel' | 'entity'; id: string; label: string }> | null;
  breaking: Readonly<{ progress: number; label: string }> | null;
}>;

export type GameplayUiProjection = Readonly<{
  hud: Readonly<{
    health: Readonly<{ value: number; max: 20 }>;
    hunger: Readonly<{ value: number; max: 20 }>;
    selectedHotbarSlot: number;
    hotbar: readonly GameplayItemPresentation[];
  }>;
  interaction: Readonly<{
    target: GameplayUiSource['target'];
    breaking: GameplayUiSource['breaking'];
  }>;
  shell: Readonly<{
    gameplay: Readonly<{
      inventoryOpen: boolean;
      lifecycle: 'alive' | 'dead';
      inventory: readonly GameplayItemPresentation[];
      selectedHotbarSlot: number;
      craftableRecipeIds: readonly string[];
      recipes: readonly Readonly<{
        id: string;
        name: string;
        requirements: string;
        result: string;
        craftable: boolean;
      }>[];
    }>;
  }>;
}>;

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const reuse = <Value>(next: Value, previous?: Value): Value => (previous && equal(next, previous) ? previous : next);

const projectInventory = (
  inventory: GameplayUiSource['player']['inventory'],
  length: number,
): readonly GameplayItemPresentation[] =>
  Array.from({ length }, (_, slot) => {
    const stack = inventory[slot];
    return stack
      ? {
          slot,
          itemId: stack.itemId,
          count: stack.count,
          name: getItemDefinition(stack.itemId).name,
          edible: getItemDefinition(stack.itemId).itemType === 'food',
        }
      : { slot, itemId: null, count: 0, name: '空槽位', edible: false };
  });

export function projectGameplayUi(source: GameplayUiSource, previous?: GameplayUiProjection): GameplayUiProjection {
  const inventory = projectInventory(source.player.inventory, 24);
  const hud = reuse(
    {
      health: { value: source.player.health, max: 20 as const },
      hunger: { value: source.player.hunger, max: 20 as const },
      selectedHotbarSlot: source.player.selectedHotbarSlot,
      hotbar: inventory.slice(0, 8),
    },
    previous?.hud,
  );
  const interaction = reuse(
    {
      target: source.target ? { ...source.target } : null,
      breaking: source.breaking ? { ...source.breaking } : null,
    },
    previous?.interaction,
  );
  const shell = reuse(
    {
      gameplay: {
        inventoryOpen: source.inventoryOpen,
        lifecycle: source.player.lifecycle,
        inventory,
        selectedHotbarSlot: source.player.selectedHotbarSlot,
        craftableRecipeIds: [...source.craftableRecipeIds],
        recipes: listRecipes().map((recipe) => ({
          id: recipe.id,
          name: getItemDefinition(recipe.outputs[0].itemId).name,
          requirements: recipe.inputs
            .map((stack) => `${getItemDefinition(stack.itemId).name} × ${stack.count}`)
            .join(' + '),
          result: recipe.outputs.map((stack) => `${getItemDefinition(stack.itemId).name} × ${stack.count}`).join(' + '),
          craftable: source.craftableRecipeIds.includes(recipe.id),
        })),
      },
    },
    previous?.shell,
  );
  return { hud, interaction, shell };
}
