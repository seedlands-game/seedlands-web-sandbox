import { projectStationUi, type StationUiPresentation } from './station-ui-projector';
import type { AuthorityStationView } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import type { StationRecipe } from '@seedlands/stdlib/mod-api';
import { projectCombatUi, type CombatUiProjection } from './combat-ui-projector';
import type { CombatSnapshot } from '@seedlands/stdlib/server/gameplay/combat-runtime';
import type { ItemDefinition } from '@seedlands/stdlib/server/gameplay/item-registry';
import type { Recipe } from '@seedlands/stdlib/server/gameplay/recipe-registry';
import {
  listClassicItemDefinitions,
  requireClassicItemDefinition,
} from '../../client/presentation/classic-item-registry';
import type { ActorMode } from './ui-contracts';

export type GameplayItemPresentation = Readonly<{
  slot: number;
  itemId: string | null;
  count: number;
  name: string;
  edible: boolean;
  stackLimit?: number;
  durability?: Readonly<{ current: number; max: number }>;
}>;

export type GameplayUiSource = Readonly<{
  station?: AuthorityStationView | null;
  stationRecipes?: readonly StationRecipe[];
  revision: number;
  inventoryIdentity?: string;
  cursor?: Readonly<{ stack: GameplayUiSource['player']['inventory'][number] }>;
  items?: readonly ItemDefinition[];
  recipes?: readonly Recipe[];
  player: Readonly<{
    combat?: CombatSnapshot;
    lifecycle: 'alive' | 'dead';
    health: number;
    hunger: number;
    selectedHotbarSlot: number;
    inventory: readonly (Readonly<{
      itemId: string;
      count: number;
      instance?: Readonly<{ durability: number }>;
    }> | null)[];
    mode?: Readonly<{ version: 1; value: ActorMode; revision: number }>;
    creativeCatalog?: Readonly<{
      version: 1;
      hotbar: readonly (string | null)[];
      selectedSlot: number;
      revision: number;
    }>;
    flight?: Readonly<{ version: 1; enabled: boolean; revision: number }>;
  }>;
  inventoryOpen: boolean;
  craftableRecipeIds: readonly string[];
  target: Readonly<{ kind: 'voxel' | 'entity'; id: string; label: string; voxel?: number }> | null;
  breaking: Readonly<{ progress: number; label: string }> | null;
}>;

export type GameplayUiProjection = Readonly<{
  hud: Readonly<{
    combat: CombatUiProjection;
    health: Readonly<{ value: number; max: 20 }>;
    hunger: Readonly<{ value: number; max: 20 }>;
    mode: ActorMode;
    flightEnabled: boolean;
    selectedHotbarSlot: number;
    hotbar: readonly GameplayItemPresentation[];
  }>;
  interaction: Readonly<{
    target: GameplayUiSource['target'];
    breaking: GameplayUiSource['breaking'];
  }>;
  shell: Readonly<{
    gameplay: Readonly<{
      station: StationUiPresentation | null;
      inventoryOpen: boolean;
      cursor: GameplayItemPresentation | null;
      inventoryIdentity: string;
      lifecycle: 'alive' | 'dead';
      mode: ActorMode;
      flightEnabled: boolean;
      inventory: readonly GameplayItemPresentation[];
      creativeCatalog: readonly GameplayItemPresentation[];
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

const itemResolver = (definitions?: readonly ItemDefinition[]) => {
  if (!definitions) return { list: listClassicItemDefinitions, require: requireClassicItemDefinition };
  const byId = new Map(definitions.map((definition) => [definition.id, definition] as const));
  return {
    list: () => definitions,
    require(itemId: string) {
      const definition = byId.get(itemId);
      if (!definition) throw new RangeError(`Unknown world item: ${itemId}`);
      return definition;
    },
  };
};

const projectInventory = (
  inventory: GameplayUiSource['player']['inventory'],
  length: number,
  requireItem: (itemId: string) => ItemDefinition,
): readonly GameplayItemPresentation[] =>
  Array.from({ length }, (_, slot) => {
    const stack = inventory[slot];
    return stack
      ? {
          ...(stack.instance && requireItem(stack.itemId).durability
            ? { durability: { current: stack.instance.durability, max: requireItem(stack.itemId).durability!.max } }
            : {}),
          slot,
          itemId: stack.itemId,
          count: stack.count,
          stackLimit: requireItem(stack.itemId).stackLimit,
          name: requireItem(stack.itemId).name,
          edible: requireItem(stack.itemId).capabilities.some((capability) => capability.type === 'consume'),
        }
      : { slot, itemId: null, count: 0, name: '空槽位', edible: false };
  });

export function projectGameplayUi(source: GameplayUiSource, previous?: GameplayUiProjection): GameplayUiProjection {
  const items = itemResolver(source.items);
  const recipes = source.recipes ?? [];
  const inventory = projectInventory(source.player.inventory, 24, items.require);
  const mode = source.player.mode?.value ?? 'survival';
  const flightEnabled = mode === 'creative' && Boolean(source.player.flight?.enabled);
  const creativeHotbar = Array.from({ length: 8 }, (_, slot) => {
    const itemId = source.player.creativeCatalog?.hotbar[slot] ?? null;
    const definition = itemId ? items.require(itemId) : null;
    return {
      slot,
      itemId,
      count: 0,
      name: definition?.name ?? '空槽位',
      edible: Boolean(definition?.capabilities.some((capability) => capability.type === 'consume')),
    };
  });
  const selectedHotbarSlot =
    mode === 'creative' ? (source.player.creativeCatalog?.selectedSlot ?? 0) : source.player.selectedHotbarSlot;
  const hotbar = mode === 'creative' ? creativeHotbar : inventory.slice(0, 8);
  const hud = reuse(
    {
      combat: projectCombatUi(source.player.combat),
      health: { value: source.player.health, max: 20 as const },
      hunger: { value: source.player.hunger, max: 20 as const },
      mode,
      flightEnabled,
      selectedHotbarSlot,
      hotbar,
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
        station: projectStationUi(
          source.station,
          source.stationRecipes ?? [],
          (input, length) => projectInventory(input, length, items.require),
          (id) => items.require(id).name,
        ),
        inventoryOpen: source.inventoryOpen,
        inventoryIdentity: source.inventoryIdentity ?? '',
        cursor: source.cursor?.stack ? projectInventory([source.cursor.stack], 1, items.require)[0] : null,
        lifecycle: source.player.lifecycle,
        mode,
        flightEnabled,
        inventory,
        creativeCatalog: items.list().map((definition, slot) => ({
          slot,
          itemId: definition.id,
          count: 0,
          name: definition.name,
          edible: definition.capabilities.some((capability) => capability.type === 'consume'),
        })),
        selectedHotbarSlot,
        craftableRecipeIds: [...source.craftableRecipeIds],
        recipes: recipes.map((recipe) => ({
          id: recipe.id,
          name: items.require(recipe.outputs[0].itemId).name,
          requirements: recipe.inputs
            .map((stack) => `${items.require(stack.itemId).name} × ${stack.count}`)
            .join(' + '),
          result: recipe.outputs.map((stack) => `${items.require(stack.itemId).name} × ${stack.count}`).join(' + '),
          craftable: source.craftableRecipeIds.includes(recipe.id),
        })),
      },
    },
    previous?.shell,
  );
  return { hud, interaction, shell };
}
