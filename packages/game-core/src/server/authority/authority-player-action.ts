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
    case 'select-hotbar':
      return server.selectHotbarSlot(playerId, action.slot);
    case 'craft':
      return server.craft(playerId, action.recipeId);
    case 'attack':
      return server.attackEntity(playerId, action.targetId);
    case 'begin-break':
      return server.beginBreak(playerId, action.position);
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
