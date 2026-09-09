import { executeBlockModuleCommand } from './block-module-command';
import { executeInventoryModuleCommand } from './inventory-module-command';
import { executeModeCommand, type ModuleCommandPort } from './module-command';
import type { GameServer, WorldCommitResult } from '../game-server';
import { isItemId, type ItemId } from '../gameplay/item-registry';
import { listVoxelGameplayDefinitions } from '../gameplay/voxel-gameplay';
import type { CommandSource, ServerCommand } from './command-contract';

export type GameplayCommand = Exclude<
  ServerCommand,
  | { type: 'set-block' }
  | { type: 'fill' }
  | { type: 'teleport' }
  | { type: 'time-get' }
  | { type: 'time-set' }
  | { type: 'seed' }
  | { type: 'save' }
  | { type: 'inspect-voxel' }
  | { type: 'inspect-chunk' }
  | { type: 'advance-gameplay' }
>;

export type GameplayCommandPayload = {
  message: string;
  data?: unknown;
  affectedChunks?: string[];
  commit?: WorldCommitResult;
};

export class GameplayCommandPermissionError extends Error {}

const MAX_DEVELOPER_QUERY_DISTANCE = 256;

const playerId = (source: CommandSource, explicit?: string): string => {
  const id = explicit ?? source.entityId;
  if (!id) throw new TypeError('Gameplay command requires CommandSource.entityId or an explicit entityId.');
  return id;
};

const position = (value: readonly [number, number, number]): [number, number, number] => {
  if (!value.every(Number.isFinite)) throw new TypeError('Position values must be finite numbers.');
  return [...value];
};

const voxelPosition = (value: readonly [number, number, number]): [number, number, number] => {
  if (!value.every(Number.isInteger)) throw new TypeError('Voxel position values must be integers.');
  return [...value];
};

const positive = (value: number, label: string, integer = false): number => {
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value)))
    throw new TypeError(`${label} must be a positive ${integer ? 'integer' : 'number'}.`);
  return value;
};

const boundedQueryDistance = (value: number, label: string): number => {
  const distance = positive(value, label);
  if (distance > MAX_DEVELOPER_QUERY_DISTANCE)
    throw new RangeError(`${label} must not exceed ${MAX_DEVELOPER_QUERY_DISTANCE}.`);
  return distance;
};

const boundedQueryTarget = (
  origin: readonly [number, number, number],
  target: readonly [number, number, number],
): [number, number, number] => {
  const checked = position(target);
  if (Math.hypot(checked[0] - origin[0], checked[1] - origin[1], checked[2] - origin[2]) > MAX_DEVELOPER_QUERY_DISTANCE)
    throw new RangeError(`Path target must be within ${MAX_DEVELOPER_QUERY_DISTANCE} blocks of the actor.`);
  return checked;
};

const mutationPayload = (
  message: string,
  result: { success: boolean; reason?: string; commit?: WorldCommitResult },
) => {
  if (!result.success) throw new Error(result.reason ?? 'Gameplay operation failed.');
  return {
    message,
    data: result,
    ...(result.commit ? { commit: result.commit, affectedChunks: result.commit.structuralChange?.chunks ?? [] } : {}),
  };
};

export async function executeGameplayCommand(
  server: GameServer,
  source: CommandSource,
  command: GameplayCommand,
  moduleOperation?: ModuleCommandPort,
): Promise<GameplayCommandPayload> {
  const block = executeBlockModuleCommand(server, source, command, moduleOperation);
  if (block) return block;
  const inventory = executeInventoryModuleCommand(server, source, command, moduleOperation);
  if (inventory) return inventory;
  switch (command.type) {
    case 'set-mode':
    case 'set-flight':
    case 'set-creative-slot':
      return executeModeCommand(source, command, moduleOperation);
    case 'query-player-state': {
      const id = playerId(source, command.entityId);
      return { message: `Player state for ${id}.`, data: { player: server.getPlayerState(id) } };
    }
    case 'query-inventory': {
      const id = playerId(source, command.entityId);
      const inventory = server.getInventory(id);
      return {
        message: `Inventory for ${id}.`,
        data: { inventory: { ...inventory, capacity: inventory.slots.length, slots: inventory.slots.filter(Boolean) } },
      };
    }
    case 'query-entity':
      return { message: `Entity ${command.entityId}.`, data: { entity: server.getEntity(command.entityId) } };
    case 'query-nearby': {
      const id = playerId(source);
      const entity = server.getEntity(id);
      if (!entity) throw new RangeError(`Unknown entity: ${id}`);
      return {
        message: `Entities within ${command.radius}.`,
        data: { entities: server.queryNearbyEntities(entity.position, positive(command.radius, 'Radius')) },
      };
    }
    case 'query-item-definitions':
      return { message: 'Item definitions.', data: { items: server.itemDefinitions.list() } };
    case 'query-voxel-definitions':
      return { message: 'Voxel gameplay definitions.', data: { voxels: listVoxelGameplayDefinitions() } };
    case 'query-recipes': {
      const recipes = command.craftable ? server.listCraftableRecipes(playerId(source)) : server.listRecipes();
      return { message: 'Recipe definitions.', data: { recipes } };
    }
    case 'query-observation': {
      const id = playerId(source, command.entityId);
      const observation = server.observeActor(
        id,
        command.range === undefined ? undefined : boundedQueryDistance(command.range, 'Range'),
      );
      return { message: `Observation for ${id}.`, data: { observation } };
    }
    case 'query-pois': {
      const id = playerId(source, command.entityId);
      const entity = server.getEntity(id);
      if (!entity) throw new RangeError(`Unknown entity: ${id}`);
      const pois = server.queryPois(entity.position, boundedQueryDistance(command.radius, 'Radius'), command.kind);
      return { message: `POIs within ${command.radius} of ${id}.`, data: { pois } };
    }
    case 'query-action': {
      const id = playerId(source, command.entityId);
      const action = command.actionId ? server.getAction(command.actionId) : server.getActorAction(id);
      return { message: `Action for ${id}.`, data: { action } };
    }
    case 'query-path': {
      const id = playerId(source, command.entityId);
      const entity = server.getEntity(id);
      if (!entity) throw new RangeError(`Unknown actor: ${id}`);
      const path = server.queryNavigationPath(id, boundedQueryTarget(entity.position, command.position));
      return { message: `Navigation path for ${id}.`, data: { path } };
    }
    case 'select-slot': {
      const state = server.getActorModeState(playerId(source));
      if (server.hasGameplayComposition && state?.mode === 'creative') {
        if (!Number.isSafeInteger(command.slot) || command.slot < 0 || command.slot >= 8)
          throw new TypeError('Creative slot is invalid.');
        return executeModeCommand(
          source,
          {
            type: 'set-creative-slot',
            slot: command.slot,
            itemId: state.creativeCatalog.hotbar[command.slot],
          },
          moduleOperation,
        );
      }
      return mutationPayload('Selected hotbar slot.', server.selectHotbarSlot(playerId(source), command.slot));
    }
    case 'break-voxel':
      return mutationPayload(
        'Started breaking voxel.',
        server.beginBreak(playerId(source), voxelPosition(command.position)),
      );
    case 'cancel-break':
      return mutationPayload('Cancelled breaking voxel.', server.cancelBreak(playerId(source)));
    case 'place-voxel':
      return mutationPayload('Placed voxel.', server.placeVoxel(playerId(source), voxelPosition(command.position)));
    case 'pickup-item':
      return mutationPayload('Picked up world item.', server.pickupItem(playerId(source), command.entityId));
    case 'drop-item':
      return mutationPayload(
        'Dropped inventory item.',
        server.dropItem(playerId(source), command.slot, positive(command.count, 'Count', true)),
      );
    case 'use-item':
      return mutationPayload('Used selected item.', server.useSelectedItem(playerId(source)));
    case 'craft-recipe':
      return mutationPayload('Crafted recipe.', server.craft(playerId(source), command.recipeId));
    case 'attack-entity': {
      if (!server.hasGameplayComposition)
        return mutationPayload('Attacked entity.', server.attackEntity(playerId(source), command.entityId));
      if (!moduleOperation) throw new Error('Combat requires a host-authorized module binding.');
      const result = moduleOperation(playerId(source), {
        operationId: 'seedlands:request-combat',
        target: { kind: 'entity', entityId: command.entityId },
        input: { targetId: command.entityId },
      });
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      return { message: 'Attacked entity.', data: result.value };
    }
    case 'respawn':
      return mutationPayload('Respawned player.', server.respawnPlayer(playerId(source)));
    case 'start-action': {
      const id = playerId(source, command.entityId);
      if (command.action === 'attack' && server.hasGameplayComposition) {
        if (!moduleOperation || !command.targetEntityId)
          throw new Error('Combat requires a host-authorized module binding and target.');
        const result = moduleOperation(id, {
          operationId: 'seedlands:request-combat',
          target: { kind: 'entity', entityId: command.targetEntityId },
          input: { targetId: command.targetEntityId },
        });
        if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
        const action = server.getActorAction(id);
        return { message: `Started Combat action ${action?.id} for ${id}.`, data: { action } };
      }
      const action = server.startActorAction(id, {
        type: command.action,
        ...(command.position ? { targetPosition: position(command.position) } : {}),
        ...(command.targetEntityId ? { targetEntityId: command.targetEntityId } : {}),
        ...(command.poiId ? { poiId: command.poiId } : {}),
      });
      return { message: `Started action ${action.id} for ${id}.`, data: { action } };
    }
    case 'interrupt-action': {
      const id = playerId(source, command.entityId);
      return { message: `Interrupted action for ${id}.`, data: { interrupted: server.interruptActorAction(id) } };
    }
    case 'give-item': {
      const definition = server.itemDefinitions.require(command.itemId);
      return mutationPayload(
        `Gave ${command.count} ${definition.id}.`,
        server.giveItem(playerId(source, command.entityId), {
          itemId: definition.id,
          count: positive(command.count, 'Count', true),
        }),
      );
    }
    case 'remove-item': {
      const definition = server.itemDefinitions.require(command.itemId);
      return mutationPayload(
        `Removed ${command.count} ${definition.id}.`,
        server.removeItem(playerId(source, command.entityId), {
          itemId: definition.id,
          count: positive(command.count, 'Count', true),
        }),
      );
    }
    case 'spawn-world-item': {
      const definition = server.itemDefinitions.require(command.itemId);
      const entity = server.spawnWorldItem(position(command.position), {
        itemId: definition.id,
        count: positive(command.count, 'Count', true),
      });
      return { message: `Spawned world item ${entity.id}.`, data: { entity } };
    }
    case 'spawn-creature': {
      const entity = server.spawnEntity({
        id: command.id,
        type: 'creature',
        position: position(command.position),
        health: 12,
        maxHealth: 12,
      });
      return { message: `Spawned creature ${entity.id}.`, data: { entity } };
    }
    case 'spawn-actor': {
      const entity = server.spawnAutonomousActor({
        id: command.id,
        archetype: command.archetype,
        position: position(command.position),
      });
      return { message: `Spawned ${command.archetype} ${entity.id}.`, data: { entity } };
    }
    case 'register-poi': {
      if (!command.label.trim()) throw new TypeError('POI label must not be empty.');
      const poi = server.registerPoi({
        id: command.id,
        kind: command.kind,
        position: position(command.position),
        label: command.label,
      });
      return { message: `Registered POI ${poi.id}.`, data: { poi } };
    }
    case 'remove-poi':
      if (!server.removePoi(command.poiId)) throw new RangeError(`Unknown POI: ${command.poiId}`);
      return { message: `Removed POI ${command.poiId}.` };
    case 'despawn-entity':
      if (!server.despawnEntity(command.entityId)) throw new RangeError(`Unknown entity: ${command.entityId}`);
      return { message: `Despawned entity ${command.entityId}.` };
    case 'apply-damage':
      return mutationPayload(
        'Applied damage.',
        server.applyDamage(
          source.actorId,
          playerId(source, command.entityId),
          positive(command.amount, 'Damage'),
          'command',
        ),
      );
    case 'heal':
      return mutationPayload(
        'Healed player.',
        server.healPlayer(playerId(source, command.entityId), positive(command.amount, 'Heal')),
      );
  }
}

export const itemIdFromCommand = (value: string): ItemId => {
  const normalized = value.toLowerCase();
  if (!isItemId(normalized)) throw new TypeError(`Invalid item id: ${value}`);
  return normalized;
};
