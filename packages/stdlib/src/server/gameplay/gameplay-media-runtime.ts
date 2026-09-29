import type { WorldComposition } from '../composition/contracts';
import { createContentItemIdentityResolver } from '../composition/content-item-identity';
import { assertActorResourceExecution } from '../composition/secondary-resource-authorization';
import type { EntityStore } from './entity-store';
import type { GameplayCallbacks } from './gameplay-runtime-contracts';
import { prepareGameplayMediaChange } from './gameplay-media-commit';
import { createGameplayMediaTargetRuntime } from './gameplay-media-target-runtime';
import type { GameplayStructureCounters } from './gameplay-structure-commit';
import { gameplayContentFromComposition } from './modules/content-capabilities';
import { MEDIA_PLAYBACK_CAPABILITY, type MediaPlaybackCapabilityV1 } from './modules/media-playback-module';
import { RegisteredMediaPlaybackRuntime } from './modules/registered-media-playback-runtime';
import type { GameplayModuleRuntime } from './modules/gameplay-module-runtime';
import type { KernelStateOwner } from '@seedlands/kernel/execution';
import { playerInteractionOrigin, positionsInRange, voxelCenter } from './gameplay-geometry';
import { traceVoxelRay } from './voxel-ray';

type Position = readonly [number, number, number];

export function createRegisteredGameplayMedia(
  options: Readonly<{
    composition?: WorldComposition;
    callbacks: GameplayCallbacks;
    entities: EntityStore;
    kernelState: KernelStateOwner;
    counters: GameplayStructureCounters;
    modules(): GameplayModuleRuntime;
  }>,
) {
  const enabled = options.composition?.definitionMap.capabilities.some(({ id }) => id === MEDIA_PLAYBACK_CAPABILITY);
  if (!enabled) return null;
  if (!options.callbacks.getLoadedCell) throw new TypeError('Registered Media host loaded-cell port is unavailable.');
  const composition = options.composition!;
  const content = gameplayContentFromComposition(composition);
  const identity = createContentItemIdentityResolver(composition.definitionMap);
  const model = composition.capability<MediaPlaybackCapabilityV1>(MEDIA_PLAYBACK_CAPABILITY).resolve();
  const providerModuleId = composition.definitionMap.capabilities.find(
    ({ id }) => id === MEDIA_PLAYBACK_CAPABILITY,
  )?.moduleId;
  const providerPackId = composition.definitionMap.modules.find(({ id }) => id === providerModuleId)?.packId;
  if (!providerPackId) throw new TypeError('Media playback provider Pack is unavailable.');
  for (const track of model.tracks) {
    const pack =
      track.resource.packId === providerPackId
        ? composition.packLock.find(({ id }) => id === providerPackId)
        : undefined;
    if (!pack?.integrity.resources.some(({ path }) => path === track.resource.path))
      throw new TypeError(
        'Media track resource is not present in the composition Pack lock: ' +
          track.id +
          ' -> ' +
          track.resource.packId +
          '/' +
          track.resource.path,
      );
  }
  const voxelId = (position: Position) => {
    const cell = options.callbacks.getLoadedCell!([...position]);
    return cell ? content.voxelSemantics.get(cell.voxel)?.id : undefined;
  };
  const readActor = (actorId: string) => {
    const entity = options.entities.get(actorId);
    if (entity?.type !== 'player') throw new Error('media-actor-unavailable');
    const actor = options.entities.playerStateAccess(actorId);
    return {
      actorId,
      lifecycle: actor.lifecycle,
      mode: actor.mode,
      inventoryRevision: actor.inventoryRevision,
      selectedSlot: actor.mode === 'creative' ? actor.creativeCatalog.selectedSlot : actor.selectedSlot,
      selectedItemId:
        actor.mode === 'creative'
          ? (actor.creativeCatalog.hotbar[actor.creativeCatalog.selectedSlot] ?? null)
          : (actor.inventory.slot(actor.selectedSlot)?.itemId ?? null),
      slots: actor.inventory.snapshot(),
    };
  };
  const runtime = new RegisteredMediaPlaybackRuntime({
    model,
    items: content.items,
    getVoxelId: voxelId,
    readActor,
    resolveItemStorageId: (itemId) => identity.storageIdForDefinitionId(itemId) ?? undefined,
    prepareInventory({ actorId, expectedRevision, slots }) {
      const actor = options.entities.playerStateAccess(actorId);
      if (actor.inventoryRevision !== expectedRevision) throw new Error('inventory-stale');
      if (actor.mode === 'creative') return Object.freeze({ validate() {}, apply() {} });
      const components = options.entities.actorComponentSnapshot(actorId);
      const mutation = options.entities.prepareMutation({
        actors: [
          {
            reference: options.entities.createReference(actorId)!,
            health: actor.health,
            components: { ...components, inventory: [...slots] },
          },
        ],
      });
      return Object.freeze({ validate: mutation.validate, apply: () => void mutation.apply() });
    },
    assertActorAuthorized(execution) {
      if (execution.context.kind !== 'actor') throw new TypeError('Media actor execution is required.');
      assertActorResourceExecution(composition, execution.authorizer, execution.context, execution.resource);
    },
    assertTargetReachable(actorId, position) {
      const entity = options.entities.get(actorId);
      if (!entity || !positionsInRange(playerInteractionOrigin(entity.position), voxelCenter([...position]), 5))
        throw new Error('out-of-range');
      const visibility = traceVoxelRay(
        voxelCenter([...position]),
        playerInteractionOrigin(entity.position),
        (x, y, z) => options.callbacks.getLoadedCell!([x, y, z])?.voxel,
      );
      if (visibility !== 'clear')
        throw new Error(visibility === 'unavailable' ? 'media-device-unavailable' : 'blocked');
    },
    worldRevision: () => options.kernelState.worldRevision,
    prepareGameplayChange: (inventoryChanged) =>
      prepareGameplayMediaChange(options.kernelState, options.counters, inventoryChanged),
  });
  const targets = createGameplayMediaTargetRuntime({
    composition,
    entities: options.entities,
    semantics: content.voxelSemantics,
    runtime,
    readVoxel: (position) => options.callbacks.getLoadedCell!([...position])?.voxel,
    invoke: (actorId, request) =>
      options.modules().invokeActor(options.callbacks.moduleActorAuthority, actorId, request),
  });
  return Object.freeze({
    runtime,
    targets,
    prepareDependentRemoval(position: readonly [number, number, number]) {
      const removal = runtime.prepareDependentRemoval(position);
      const storageId = removal.ejectedItem ? identity.storageIdForDefinitionId(removal.ejectedItem.itemId) : undefined;
      if (removal.ejectedItem && !storageId) throw new Error('media-dependent-item-identity-missing');
      return Object.freeze({
        removed: removal.removed,
        ejectedItem: storageId ? Object.freeze({ itemId: storageId, count: 1 }) : null,
        facts: removal.fact ? Object.freeze([removal.fact]) : Object.freeze([]),
        validate: removal.validate,
        apply: removal.apply,
      });
    },
  });
}
