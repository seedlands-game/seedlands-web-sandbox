import type { GameServer } from '../game-server';
import type { AuthorityAction } from '../protocol/authority-worker-protocol';
import { CROP_INTERACTION_CAPABILITY, type CropInteractionConfig } from '../gameplay/modules/crop-interaction-model';

/** Target-first crop actions still execute the registered prepared host, never the direct child mutators. */
export function dispatchAuthorityCropTarget(
  server: GameServer,
  playerId: string,
  action: Extract<AuthorityAction, { type: 'interact' }>,
) {
  const composition = server.options.composition;
  if (
    action.target.kind !== 'voxel' ||
    !composition?.definitionMap.capabilities.some(({ id }) => id === CROP_INTERACTION_CAPABILITY)
  )
    return null;
  const config = composition.capability<CropInteractionConfig>(CROP_INTERACTION_CAPABILITY);
  if (!server.crops.at(action.target.hit)) return null;
  const player = server.getPlayerState(playerId);
  const inventory = server.getInventoryPointerView(playerId);
  const creative = player.mode?.value === 'creative';
  const selectedSlot = creative ? (player.creativeCatalog?.selectedSlot ?? 0) : player.selectedSlot;
  const expected = action.expectedSelection;
  if (player.lifecycle !== 'alive') return { success: false as const, reason: 'player-dead' };
  if (
    inventory.revision !== expected.inventoryRevision ||
    player.mode?.revision !== expected.modeRevision ||
    player.creativeCatalog?.revision !== expected.creativeCatalogRevision ||
    selectedSlot !== expected.selectedSlot
  )
    return { success: false as const, reason: 'stale-selection' };
  const selected = creative ? player.creativeCatalog?.hotbar[selectedSlot] : inventory.slots[selectedSlot]?.itemId;
  if (action.intent === 'use' && selected === config.seedItemId) return null;
  const operationId =
    action.intent === 'use' && config.fertilizer && selected === config.fertilizer.itemId
      ? config.fertilizeOperationId
      : config.harvestOperationId;
  if (!operationId) return null;
  const result = server.invokeActorModuleOperation(playerId, {
    operationId,
    target: { kind: 'voxel', position: [...action.target.hit] },
    input: {
      version: 1,
      trigger: 'voxel',
      target: { kind: 'voxel', hit: [...action.target.hit], adjacent: [...action.target.adjacent] },
    },
  });
  return result.ok
    ? { success: true as const, handled: true as const, value: result.value }
    : { success: false as const, reason: result.message };
}
