import type { ModuleInvocationValue } from '../composition/contracts';
import type {
  AuthorityAction,
  AuthorityActionResult,
  AuthorityGameplayView,
} from '../protocol/authority-worker-protocol';
import type { GameServer } from '../game-server';
import type { WorldCommitResult } from '../game-server-types';
import { dispatchItemInteraction } from '../gameplay/modules/item-interaction-module';
import {
  dispatchStructureTargetFirstV1,
  type StructureTargetPortV1,
} from '../gameplay/modules/structure-target-dispatch';
import type { MediaTargetPortV1 } from '../gameplay/gameplay-media-target-runtime';

export type AuthorityStructureTargetPort = Pick<StructureTargetPortV1, 'resolve' | 'invoke'>;
export type AuthorityMediaTargetPort = Pick<MediaTargetPortV1, 'resolve' | 'invoke'>;

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
  structureTargets?: AuthorityStructureTargetPort,
  mediaTargets?: AuthorityMediaTargetPort,
): unknown {
  const record = (result: unknown, statistic: import('../gameplay/gameplay-progress-runtime').GameplayStatistic) => {
    if ((result as { success?: boolean })?.success) server.progress.record(playerId, statistic, 1);
    return result;
  };
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
      return record(server.craft(playerId, action.recipeId), 'items-crafted');
    case 'attack':
      return server.attackEntity(playerId, action.targetId);
    case 'begin-break': {
      const result = server.beginBreak(playerId, action.position);
      if ('success' in result && result.success && result.commit) publishCommit(result.commit);
      return result;
    }
    case 'cancel-break':
      return server.cancelBreak(playerId);
    case 'place': {
      const result = server.placeVoxel(playerId, action.position);
      const commit = (result as { commit?: WorldCommitResult }).commit;
      if (commit) publishCommit(commit);
      return record(result, 'blocks-placed');
    }
    case 'respawn':
      return server.respawnPlayer(playerId);
    case 'move-inventory':
      return server.moveInventorySlot(playerId, action.source, action.target);
    case 'use-inventory':
      return record(server.useInventoryItem(playerId, action.slot), 'items-consumed');
    case 'interact': {
      const actor = (id: string) => {
        const entity = server.getEntity(id);
        if (entity?.type !== 'player') return null;
        const player = server.getPlayerState(id);
        const inventory = server.getInventoryPointerView(id);
        return {
          position: entity.position,
          lifecycle: player.lifecycle,
          mode: player.mode?.value ?? 'survival',
          inventoryRevision: inventory.revision,
          modeRevision: player.mode?.revision ?? 0,
          creativeCatalogRevision: player.creativeCatalog?.revision ?? 0,
          selectedSlot:
            player.mode?.value === 'creative' ? (player.creativeCatalog?.selectedSlot ?? 0) : player.selectedSlot,
          survivalItemId: player.inventory[player.selectedSlot]?.itemId ?? null,
          creativeItemId: player.creativeCatalog?.hotbar[player.creativeCatalog.selectedSlot] ?? null,
        };
      };
      const fallback = () =>
        dispatchItemInteraction(
          {
            actor,
            resolveEntity: (reference) => server.resolveEntityReference(reference),
            resolveInteraction: (itemId, trigger) => server.resolveItemInteraction(itemId, trigger),
            invokeActor: (request) => server.invokeActorModuleOperation(playerId, request),
            getVoxel: (position) => server.getVoxel(...position),
          },
          playerId,
          action.target,
          action.expectedSelection,
        );
      const structureFallback = () =>
        structureTargets
          ? dispatchStructureTargetFirstV1(
              {
                actor,
                getVoxel: (position) => server.getVoxel(...position),
                resolve: structureTargets.resolve,
                invoke: structureTargets.invoke,
                fallback,
              },
              {
                actorId: playerId,
                intent: action.intent,
                target: action.target,
                expectedSelection: action.expectedSelection,
              },
            )
          : fallback();
      let interaction;
      if (mediaTargets && action.target.kind === 'voxel') {
        const currentActor = actor(playerId);
        const expected = action.expectedSelection;
        if (!currentActor || currentActor.lifecycle !== 'alive') return { success: false, reason: 'player-dead' };
        if (
          currentActor.inventoryRevision !== expected.inventoryRevision ||
          currentActor.modeRevision !== expected.modeRevision ||
          currentActor.creativeCatalogRevision !== expected.creativeCatalogRevision ||
          currentActor.selectedSlot !== expected.selectedSlot
        )
          return { success: false, reason: 'stale-selection' };
        const { hit, adjacent } = action.target;
        if (hit.reduce((sum, coordinate, axis) => sum + Math.abs(coordinate - adjacent[axis]!), 0) !== 1)
          return { success: false, reason: 'invalid-target' };
        const resolved = mediaTargets.resolve(playerId, action.intent, hit);
        interaction =
          resolved.status === 'not-media'
            ? structureFallback()
            : resolved.status === 'unavailable'
              ? { success: false as const, reason: 'chunk-unavailable' }
              : resolved.status === 'malformed'
                ? { success: false as const, reason: resolved.reason }
                : mediaTargets.invoke(playerId, action.intent, hit, resolved);
      } else interaction = structureFallback();
      if (interaction.success && interaction.value !== undefined) {
        const commit =
          ('commit' in interaction ? interaction.commit : undefined) ??
          server.acknowledgeBlockCommit(interaction.value);
        if (commit) publishCommit(commit);
      }
      return interaction;
    }
    case 'set-difficulty':
      return server.setDifficulty(action.value, action.expectedRevision);
  }
}
