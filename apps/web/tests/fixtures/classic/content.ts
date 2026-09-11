import {
  assembleOverworldPacks,
  gameplayContentForComposition,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
  worldgenProviderForComposition,
} from '@seedlands/stdlib/host';
import { pack } from '../../../../../playbooks/classic/src/pack';
import { overworldBlocks } from '../../../../../playbooks/classic/src/blocks';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { AutonomyRuntime as BaseAutonomyRuntime } from '../../../../../packages/stdlib/src/server/simulation/autonomy-runtime';
import {
  Inventory as BaseInventory,
  type InventorySlot,
  type InventoryAccess,
} from '@seedlands/stdlib/server/gameplay/inventory';
import type {
  ItemDefinitionRegistry,
  ItemId,
  ItemCapabilityType,
} from '@seedlands/stdlib/server/gameplay/item-registry';
import {
  craftRecipe as craft,
  listCraftableRecipes as craftable,
  type RecipeRegistry,
} from '@seedlands/stdlib/server/gameplay/recipe-registry';
import {
  CombatRuntime as BaseCombatRuntime,
  createMeleeDefinitionRegistry,
  type CombatRuntimeCallbacks,
  type MeleeDefinitionRegistry,
} from '@seedlands/stdlib/server/gameplay/combat-runtime';
import type { EntityIdentityPort } from '../../../../../packages/stdlib/src/server/simulation/action-identity';
import type { CombatOriginRuntimeOptions } from '../../../../../packages/stdlib/src/server/gameplay/combat-origin';
import {
  GameplayRuntime as BaseGameplayRuntime,
  type GameplayCallbacks,
} from '@seedlands/stdlib/server/gameplay/gameplay-runtime';
import { GameServer as BaseGameServer, type GameServerOptions } from '@seedlands/stdlib/server/game-server';

// Frozen-base assertions explicitly choose Classic. Production registries remain unconfigured.
export function createClassicComposition() {
  return assembleOverworldPacks([
    {
      ...pack,
      integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
    },
  ]);
}
export const classicContent = gameplayContentForComposition(createClassicComposition());
export const defaultItemDefinitionRegistry = classicContent.items;
export const defaultRecipeRegistry = classicContent.recipes;
export class Inventory extends BaseInventory {
  constructor(
    capacity: number,
    initial?: readonly InventorySlot[],
    items: ItemDefinitionRegistry = classicContent.items,
  ) {
    super(capacity, initial, items);
  }
}
export const getItemDefinition = (id: ItemId) => classicContent.items.require(id);
export const getItemCapability = <Type extends ItemCapabilityType>(id: ItemId, type: Type) =>
  classicContent.items.capability(id, type);
export const listItemDefinitions = () => classicContent.items.list();
export const getRecipe = (id: string) => {
  const recipe = classicContent.recipes.get(id);
  if (!recipe) throw new RangeError(`Unknown recipe: ${id}`);
  return recipe;
};
export const listRecipes = () => classicContent.recipes.list();
export const craftRecipe = (inventory: InventoryAccess, id: string, recipes: RecipeRegistry = classicContent.recipes) =>
  craft(inventory, id, recipes);
export const listCraftableRecipes = (inventory: InventoryAccess, recipes: RecipeRegistry = classicContent.recipes) =>
  craftable(inventory, recipes);
export const getVoxelGameplayDefinition = (voxel: number) => {
  const definition = overworldBlocks.find((entry) => entry.voxel === voxel);
  if (!definition) throw new RangeError(`Unknown voxel: ${voxel}`);
  return definition;
};
export const listVoxelGameplayDefinitions = () => overworldBlocks;
export const getMeleeDefinition = (id: string) => {
  const definition = classicContent.meleeDefinitions.find((entry) => entry.id === id);
  if (!definition) throw new RangeError(`Unknown melee definition: ${id}`);
  return definition;
};
export const listMeleeDefinitions = () => classicContent.meleeDefinitions;
export function classicOptions() {
  const composition = createClassicComposition();
  return {
    composition,
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'test-player' }),
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
  };
}

const classicMeleeDefinitionRegistry = createMeleeDefinitionRegistry(classicContent.meleeDefinitions);
export class CombatRuntime extends BaseCombatRuntime {
  constructor(
    callbacks: CombatRuntimeCallbacks,
    registry?: MeleeDefinitionRegistry,
    identity?: EntityIdentityPort,
    originOptions: CombatOriginRuntimeOptions = {},
  ) {
    super(callbacks, registry ?? classicMeleeDefinitionRegistry, identity, originOptions);
  }
}

export class GameplayRuntime extends BaseGameplayRuntime {
  constructor(callbacks: GameplayCallbacks) {
    const { meleeDefinitions, ...rest } = callbacks;
    super(
      callbacks.composition || callbacks.content
        ? callbacks
        : {
            ...rest,
            content: meleeDefinitions ? { ...classicContent, meleeDefinitions } : classicContent,
          },
    );
  }
}

export class GameServer extends BaseGameServer {
  constructor(options: GameServerOptions) {
    super(
      options.composition
        ? options.composition.definitionMap.capabilities.some(({ id }) => id === 'seedlands:worldgen-provider')
          ? {
              ...options,
              worldgenProvider: options.worldgenProvider ?? worldgenProviderForComposition(options.composition),
            }
          : { ...options, worldgenProvider: options.worldgenProvider ?? classicWorldgenProvider }
        : {
            ...options,
            content: options.content ?? classicContent,
            worldgenProvider: options.worldgenProvider ?? classicWorldgenProvider,
          },
    );
  }
}

import { EntityStore as BaseEntityStore } from '@seedlands/stdlib/server/gameplay/entity-store';
import type { StationStateCodec } from '@seedlands/stdlib/server/gameplay/ecs-station-state';
import { PlayerState as BasePlayerState, type PlayerSnapshot } from '@seedlands/stdlib/server/gameplay/player-state';
export class EntityStore extends BaseEntityStore {
  constructor(items: ItemDefinitionRegistry = classicContent.items, codec?: StationStateCodec) {
    super(items, codec);
  }
}
export class PlayerState extends BasePlayerState {
  constructor(
    id: string,
    position: [number, number, number],
    snapshot?: Partial<PlayerSnapshot>,
    entities?: BaseEntityStore,
    items: ItemDefinitionRegistry = entities?.items ?? classicContent.items,
  ) {
    super(id, position, snapshot, entities, items);
  }
}

export const createPlayerState = (
  id: string,
  position: [number, number, number],
  items: ItemDefinitionRegistry = classicContent.items,
) => new PlayerState(id, [...position], undefined, undefined, items);

export class AutonomyRuntime extends BaseAutonomyRuntime {
  constructor(options: ConstructorParameters<typeof BaseAutonomyRuntime>[0]) {
    super({
      ...options,
      actorProfiles: options.actorProfiles ?? classicContent.actorProfiles,
      meleeDefinitions: options.meleeDefinitions ?? classicContent.meleeDefinitions,
    });
  }
}
