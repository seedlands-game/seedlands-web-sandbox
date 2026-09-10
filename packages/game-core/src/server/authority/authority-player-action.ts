import type { ModuleInvocationValue } from '../composition/contracts';
import type {
  AuthorityAction,
  AuthorityActionResult,
  AuthorityGameplayView,
} from '../../compute/authority-worker-protocol';
import type { GameServer } from '../game-server';
import type { WorldCommitResult } from '../game-server-types';

export function unavailableAuthorityPlayerAction(
  submittedAction: AuthorityAction,
  gameplay: AuthorityGameplayView,
): AuthorityActionResult {
  return { submittedAction, result: { success: false, reason: 'chunk-unavailable' }, gameplay, commits: [] };
}

export function applyAuthorityPlayerAction(
  server: GameServer,
  playerId: string,
  action: AuthorityAction,
  publishCommit: (commit: WorldCommitResult) => void,
): unknown {
  switch (action.type) {
    case 'inventory-pointer': {
      const actor = server.resolveEntityReference(action.actor);
      if (!actor || actor.id !== playerId) return { success: false, reason: 'actor-reference-stale' };
      const result = server.inventoryPointer(playerId, {
        actor: action.actor,
        expectedInventoryRevision: action.expectedInventoryRevision,
        ...(action.station ? { station: action.station } : {}),
        command: action.command,
      });
      return result.success ? { success: true, ...(result.value ? { value: result.value } : {}) } : result;
    }
    case 'station': {
      if (!server.resolveEntityReference(action.reference)) return { success: false, reason: 'stale-station' };
      const { reference, kind, expectedStationRevision } = action;
      const input: ModuleInvocationValue =
        kind === 'craft'
          ? { expectedStationRevision, recipeId: action.recipeId }
          : {
              expectedStationRevision,
              from: action.from,
              actorSlot: action.actorSlot,
              stationSlot: action.stationSlot,
              ...(action.count === undefined ? {} : { count: action.count }),
            };
      const result = server.invokeActorModuleOperation(playerId, {
        operationId: kind === 'craft' ? 'seedlands:station-craft' : 'seedlands:station-transfer',
        target: { kind: 'entity', entityId: reference.entityId },
        input,
      });
      return result.ok ? result.value : { success: false, reason: 'station-rejected', message: result.message };
    }
    case 'select-hotbar':
      return server.selectHotbarSlot(playerId, action.slot);
    case 'craft':
      return server.craft(playerId, action.recipeId);
    case 'attack':
      return server.attackEntity(playerId, action.targetId);
    case 'begin-break': {
      const result = server.beginBreak(playerId, action.position);
      if (result.success && result.commit) publishCommit(result.commit);
      return result;
    }
    case 'cancel-break':
      return server.cancelBreak(playerId);
    case 'place': {
      const result = server.placeVoxel(playerId, action.position);
      const commit = (result as { commit?: WorldCommitResult }).commit;
      if (commit) publishCommit(commit);
      return result;
    }
    case 'respawn':
      return server.respawnPlayer(playerId);
    case 'move-inventory':
      return server.moveInventorySlot(playerId, action.source, action.target);
    case 'use-inventory':
      return server.useInventoryItem(playerId, action.slot);
  }
}
