import type { ModuleInvocationValue } from '../composition/contracts';
import type { ModuleActorAuthority } from '../composition/gameplay-actor-authority';
import type { EntityStore } from './entity-store';
import type { InventorySlot } from './inventory';
import type { GameplayModuleRuntime } from './modules/gameplay-module-runtime';
import {
  publicInventoryPointerFailureReason,
  type InventoryPointerInputV1,
  validateInventoryCursor,
  validateInventoryEquipmentProjection,
} from './modules/inventory-pointer-contract';
import { STATION_CRAFT_OPERATION, STATION_TRANSFER_OPERATION } from './modules/station-action-model';
import {
  matchesShapedStationRecipe,
  matchesShapelessStationRecipe,
  stationRecipeFitsGrid,
} from './modules/station-candidates';
import type { GameplayContent } from './gameplay-content';
const frozenSlot = (slot: InventorySlot): InventorySlot =>
  slot
    ? Object.freeze({
        ...slot,
        ...(slot.instance ? { instance: Object.freeze({ ...slot.instance }) } : {}),
      })
    : null;

type RegisteredPointerRuntime = Readonly<{
  pointer(id: string, input: InventoryPointerInputV1): InventoryPointerExecutionResult;
}>;
type InventoryPointerExecutionResult =
  Readonly<{ success: true; value?: ModuleInvocationValue }> | Readonly<{ success: false; reason: string }>;

export function projectInventoryPointerView(entities: EntityStore, content: GameplayContent, id: string) {
  const actor = entities.actorStateAccess(id);
  const equipment = validateInventoryEquipmentProjection(
    { selectedSlot: actor.selectedSlot, hotbarSize: actor.hotbarSize, armor: actor.armor },
    content.items,
    actor.inventory.capacity,
  );
  const cursor = validateInventoryCursor(actor.inventoryCursor, content.items);
  const grid = cursor.craftingGrid;
  const matchedCraftingRecipe = content.stations
    ?.listRecipes()
    .find(
      (recipe) =>
        stationRecipeFitsGrid(recipe, 2) &&
        (recipe.kind === 'shaped'
          ? matchesShapedStationRecipe(grid, recipe, content.items)
          : matchesShapelessStationRecipe(grid, recipe, content.items)),
    );
  return Object.freeze({
    version: 1 as const,
    actor: entities.createReference(id)!,
    revision: actor.inventoryRevision,
    slots: Object.freeze(actor.inventory.snapshot().map(frozenSlot)),
    hotbarSize: actor.hotbarSize,
    armor: equipment.armor,
    cursor,
    matchedCraftingRecipeIds: Object.freeze(matchedCraftingRecipe ? [matchedCraftingRecipe.id] : []),
  });
}

export function executeInventoryPointer(
  id: string,
  input: InventoryPointerInputV1,
  registeredInventory: RegisteredPointerRuntime | undefined,
  modules: GameplayModuleRuntime,
  actorAuthority?: ModuleActorAuthority,
) {
  if (!input.station) {
    if (!registeredInventory) return { success: false as const, reason: 'inventory-rejected' };
    const result = registeredInventory.pointer(id, input);
    return result.success
      ? result
      : { success: false as const, reason: publicInventoryPointerFailureReason(result.reason, false) };
  }
  const result = modules.invokeActor(actorAuthority, id, {
    operationId: input.command.kind === 'craft' ? STATION_CRAFT_OPERATION : STATION_TRANSFER_OPERATION,
    target: { kind: 'entity', entityId: input.station.reference.entityId },
    input: input as unknown as ModuleInvocationValue,
  });
  return result.ok
    ? { success: true as const, value: result.value }
    : { success: false as const, reason: publicInventoryPointerFailureReason(result.message, true) };
}
