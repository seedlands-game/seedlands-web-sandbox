import type { ModuleInvocationValue } from '../composition/contracts';
import type { ModuleActorAuthority } from '../composition/gameplay-actor-authority';
import type { EntityStore } from './entity-store';
import type { GameplayModuleRuntime } from './modules/gameplay-module-runtime';
import {
  publicInventoryPointerFailureReason,
  type InventoryPointerInputV1,
} from './modules/inventory-pointer-contract';
import { STATION_CRAFT_OPERATION, STATION_TRANSFER_OPERATION } from './modules/station-action-model';

type RegisteredPointerRuntime = Readonly<{
  pointer(id: string, input: InventoryPointerInputV1): InventoryPointerExecutionResult;
}>;
type InventoryPointerExecutionResult =
  Readonly<{ success: true; value?: ModuleInvocationValue }> | Readonly<{ success: false; reason: string }>;

export function projectInventoryPointerView(entities: EntityStore, id: string) {
  const actor = entities.actorStateAccess(id);
  return {
    version: 1 as const,
    actor: entities.createReference(id)!,
    revision: actor.inventoryRevision,
    slots: actor.inventory.snapshot(),
    hotbarSize: actor.hotbarSize,
    cursor: actor.inventoryCursor,
  };
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
