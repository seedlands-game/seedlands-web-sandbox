import type { AutonomyRuntime } from '../simulation/autonomy-runtime';
import type { GameplayContent } from './gameplay-content';
import type { PlayerState } from './player-state';

export function requestProfiledPlayerCombat(
  playerId: string,
  targetId: string,
  player: PlayerState,
  content: GameplayContent,
  simulation: AutonomyRuntime,
  changed: () => void,
) {
  const selected = player.inventory.slot(player.selectedSlot);
  const melee = selected ? content.items.capability(selected.itemId, 'melee') : undefined;
  const definitionId = melee?.definitionId ?? content.actorProfiles.defaultPlayerMeleeDefinitionId;
  if (!definitionId) return { success: false as const, reason: 'combat-unavailable' };
  const result = simulation.requestCombat(playerId, targetId, definitionId);
  if (!result.success) return result;
  changed();
  const resolved = simulation.combatSnapshotFor(playerId).lastResult;
  return {
    ...result,
    ...(resolved?.actionId === result.actionId && resolved.outcome === 'hit' ? { damage: resolved.damage } : {}),
  };
}
