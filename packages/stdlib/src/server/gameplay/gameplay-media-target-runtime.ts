import type { WorldComposition } from '../composition/contracts';
import type { RegisteredOperationRequest, RegisteredOperationResult } from '../composition/operation-contracts';
import { createContentItemIdentityResolver } from '../composition/content-item-identity';
import type { EntityStore } from './entity-store';
import { playerInteractionOrigin, positionsInRange, voxelCenter } from './gameplay-geometry';
import type { RegisteredMediaPlaybackRuntime } from './modules/registered-media-playback-runtime';
import type { MediaPlaybackActionV1 } from './modules/media-playback-model';
import {
  MEDIA_ACTIVATE_OPERATION,
  MEDIA_EJECT_OPERATION,
  MEDIA_INSERT_AND_ACTIVATE_OPERATION,
  MEDIA_INSERT_OPERATION,
  MEDIA_STOP_OPERATION,
  MEDIA_SWITCH_OPERATION,
} from './modules/media-playback-module';
import type { VoxelSemanticsRegistry } from '../../world/voxel-semantics';
import { traceVoxelRay } from './voxel-ray';

type Position = readonly [number, number, number];
export type MediaTargetResolutionV1 =
  | Readonly<{ status: 'not-media' }>
  | Readonly<{ status: 'unavailable' }>
  | Readonly<{ status: 'malformed'; reason: string }>
  | Readonly<{ status: 'resolved'; position: Position; action: MediaPlaybackActionV1; revision: number }>;
export type MediaTargetInteractionResultV1 =
  | Readonly<{ success: true; handled: true; value: import('../composition/contracts').ModuleInvocationValue }>
  | Readonly<{ success: false; reason: string }>;
export type MediaTargetPortV1 = Readonly<{
  resolve(actorId: string, intent: 'use' | 'alternate', position: Position): MediaTargetResolutionV1;
  invoke(
    actorId: string,
    intent: 'use' | 'alternate',
    position: Position,
    expected: MediaTargetResolutionV1,
  ): MediaTargetInteractionResultV1;
}>;

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function createGameplayMediaTargetRuntime(
  options: Readonly<{
    composition: WorldComposition;
    entities: EntityStore;
    semantics: VoxelSemanticsRegistry;
    runtime: RegisteredMediaPlaybackRuntime;
    readVoxel(position: Position): number | undefined;
    invoke(actorId: string, request: RegisteredOperationRequest): RegisteredOperationResult;
  }>,
): MediaTargetPortV1 {
  const identity = createContentItemIdentityResolver(options.composition.definitionMap);
  const selectedItemId = (actorId: string): string | null => {
    const entity = options.entities.get(actorId);
    if (entity?.type !== 'player') return null;
    const state = options.entities.playerStateAccess(actorId);
    return state.mode === 'creative'
      ? (state.creativeCatalog.hotbar[state.creativeCatalog.selectedSlot] ?? null)
      : (state.inventory.slot(state.selectedSlot)?.itemId ?? null);
  };
  const resolve = (actorId: string, intent: 'use' | 'alternate', position: Position): MediaTargetResolutionV1 => {
    const entity = options.entities.get(actorId);
    if (entity?.type !== 'player') return { status: 'malformed', reason: 'media-actor-unavailable' };
    const voxel = options.readVoxel(position);
    if (voxel === undefined) return { status: 'unavailable' };
    const voxelId = options.semantics.get(voxel)?.id;
    const device = options.runtime.model.devices.find((entry) => entry.target.voxelId === voxelId);
    if (!device) return { status: 'not-media' };
    if (!positionsInRange(playerInteractionOrigin(entity.position), voxelCenter([...position]), 5))
      return { status: 'malformed', reason: 'out-of-range' };
    const visibility = traceVoxelRay(voxelCenter([...position]), playerInteractionOrigin(entity.position), (x, y, z) =>
      options.readVoxel([x, y, z]),
    );
    if (visibility !== 'clear')
      return { status: visibility === 'unavailable' ? 'unavailable' : 'malformed', reason: 'blocked' };
    const state = options.runtime.read(position);
    const storageId = selectedItemId(actorId);
    if (storageId) {
      const definitionId = identity.definitionIdForStorageId(storageId);
      const binding = device.tracks.find(({ itemId }) => itemId === definitionId);
      if (!binding) return { status: 'malformed', reason: 'unsupported-media' };
      return {
        status: 'resolved',
        position: Object.freeze([...position]) as Position,
        revision: state.revision,
        action: {
          kind: state.slot ? 'switch' : device.playOnInsert ? 'insert-and-activate' : 'insert',
          itemId: binding.itemId,
        },
      };
    }
    if (!state.slot) return { status: 'malformed', reason: 'empty-slot' };
    const action: MediaPlaybackActionV1 =
      intent === 'alternate'
        ? { kind: state.playing || state.resumePending ? 'stop' : 'eject' }
        : state.playing || state.resumePending
          ? { kind: 'eject' }
          : { kind: 'activate' };
    return { status: 'resolved', position: Object.freeze([...position]) as Position, revision: state.revision, action };
  };
  return Object.freeze({
    resolve,
    invoke(actorId, intent, position, expected) {
      const current = resolve(actorId, intent, position);
      if (!same(current, expected) || current.status !== 'resolved')
        return { success: false as const, reason: 'media-target-stale' };
      const operationId =
        current.action.kind === 'insert'
          ? MEDIA_INSERT_OPERATION
          : current.action.kind === 'insert-and-activate'
            ? MEDIA_INSERT_AND_ACTIVATE_OPERATION
            : current.action.kind === 'switch'
              ? MEDIA_SWITCH_OPERATION
              : current.action.kind === 'activate'
                ? MEDIA_ACTIVATE_OPERATION
                : current.action.kind === 'stop'
                  ? MEDIA_STOP_OPERATION
                  : MEDIA_EJECT_OPERATION;
      const result = options.invoke(actorId, {
        operationId,
        target: { kind: 'voxel', position: [...position] },
        input: {
          expectedRevision: current.revision,
          ...(current.action.kind === 'insert' ||
          current.action.kind === 'insert-and-activate' ||
          current.action.kind === 'switch'
            ? { itemId: current.action.itemId }
            : {}),
        },
      });
      return result.ok
        ? { success: true as const, handled: true as const, value: result.value }
        : { success: false as const, reason: result.message };
    },
  });
}
