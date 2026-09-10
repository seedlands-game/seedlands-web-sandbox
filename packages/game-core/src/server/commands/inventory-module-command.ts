import type { GameServer } from '../game-server';
import type { CommandSource, ServerCommand } from './command-contract';
import type { RegisteredOperationRequest } from '../composition/operation-contracts';
import type { ModuleCommandPort } from './module-command';

/** Keep the caller's binding when ordinary inventory commands enter the module pipeline. */
export function executeInventoryModuleCommand(
  server: GameServer,
  source: CommandSource,
  command: ServerCommand,
  invoke?: ModuleCommandPort,
) {
  if (!server.hasGameplayComposition) return null;
  const actorId = source.entityId;
  const target = { kind: 'entity' as const, entityId: actorId ?? '' };
  let request: RegisteredOperationRequest;
  let message: string;
  switch (command.type) {
    case 'select-slot':
      if (actorId && server.getActorModeState(actorId)?.mode === 'creative') return null;
      request = { operationId: 'seedlands:inventory-select', target, input: { slot: command.slot } };
      message = 'Selected hotbar slot.';
      break;
    case 'pickup-item':
      request = { operationId: 'seedlands:inventory-pickup', target: { kind: 'entity', entityId: command.entityId } };
      message = 'Picked up world item.';
      break;
    case 'drop-item':
      request = {
        operationId: 'seedlands:inventory-drop',
        target,
        input: { slot: command.slot, count: command.count },
      };
      message = 'Dropped inventory item.';
      break;
    case 'use-item':
      if (!actorId) throw new Error('Inventory command requires a bound actor.');
      request = {
        operationId: 'seedlands:inventory-consume',
        target,
        input: { slot: server.getInventory(actorId).selectedSlot },
      };
      message = 'Used selected item.';
      break;
    case 'craft-recipe':
      request = { operationId: 'seedlands:inventory-craft', target, input: { recipeId: command.recipeId } };
      message = 'Crafted recipe.';
      break;
    default:
      return null;
  }
  if (!actorId || !invoke) throw new Error('Inventory command requires a host-authorized actor binding.');
  const result = invoke(actorId, request);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return { message, data: result.value };
}
