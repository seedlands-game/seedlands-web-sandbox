import type { WorldComposition } from '../composition/contracts';
import type { EntityStore } from './entity-store';
import type { GameplayCallbacks } from './gameplay-runtime-contracts';
import { prepareGameplayStructureChange, type GameplayStructureCounters } from './gameplay-structure-commit';
import { createStructureDependentRemoval, prepareStructureFactDelivery } from './gameplay-structure-dependent-removal';
import { createGameplayStructureTargetRuntime } from './gameplay-structure-target-runtime';
import { STRUCTURE_ACTIONS_CAPABILITY } from './modules/structure-actions-module';
import { RegisteredStructureRuntime } from './modules/registered-structure-runtime';
import type { GameplayModuleRuntime } from './modules/gameplay-module-runtime';
import type { AutonomyRuntime } from '../simulation/autonomy-runtime';
import type { KernelStateOwner } from '@seedlands/kernel/execution';
import { gameplayContentFromComposition } from './modules/content-capabilities';
import type { RegisteredMediaPlaybackRuntime } from './modules/registered-media-playback-runtime';
import type { MediaPlaybackFactV1 } from './modules/media-playback-model';

export function createRegisteredGameplayStructure(
  options: Readonly<{
    composition?: WorldComposition;
    callbacks: GameplayCallbacks;
    entities: EntityStore;
    kernelState: KernelStateOwner;
    counters: GameplayStructureCounters;
    simulation(): AutonomyRuntime;
    modules(): GameplayModuleRuntime;
    media?: RegisteredMediaPlaybackRuntime | null;
  }>,
) {
  const enabled = options.composition?.definitionMap.capabilities.some(({ id }) => id === STRUCTURE_ACTIONS_CAPABILITY);
  if (!enabled) return null;
  if (!options.callbacks.getLoadedCell || !options.callbacks.prepareVoxelEdits)
    throw new TypeError('Registered Structure host ports are unavailable.');
  const composition = options.composition!;
  const semantics = gameplayContentFromComposition(composition).voxelSemantics;
  const runtime = new RegisteredStructureRuntime({
    composition,
    entities: options.entities,
    readCell: (position) => options.callbacks.getLoadedCell!([...position]),
    prepareVoxelEdits: options.callbacks.prepareVoxelEdits,
    gameplayRevision: () => options.kernelState.gameplayRevision,
    worldRevision: () => options.kernelState.worldRevision,
    prepareGameplayChange: (inventoryChanged, commit) =>
      prepareGameplayStructureChange(options.kernelState, options.counters, inventoryChanged, commit),
    prepareFactDelivery: (facts, commit, revision) =>
      options.media
        ? options.media.prepareFactDelivery(facts as readonly MediaPlaybackFactV1[], commit.worldRevision, revision)
        : prepareStructureFactDelivery(composition, options.kernelState, facts, commit, revision),
    prepareCancellation: (actorId) => options.simulation().prepareCancellation([actorId], 'slot-changed'),
    prepareDependentRemoval: createStructureDependentRemoval(
      composition,
      (position) => options.callbacks.getLoadedCell!([...position]),
      options.media
        ? {
            prepare(position) {
              const removal = options.media!.prepareDependentRemoval(position);
              return Object.freeze({
                removed: removal.removed,
                ejectedItem: removal.ejectedItem ? { itemId: removal.ejectedItem.itemId } : null,
                facts: removal.fact ? Object.freeze([removal.fact]) : Object.freeze([]),
                validate: removal.validate,
                apply: removal.apply,
              });
            },
          }
        : undefined,
    ),
  });
  const targets = createGameplayStructureTargetRuntime({
    composition,
    runtime,
    entities: options.entities,
    readVoxel: (position) => options.callbacks.getLoadedCell!([...position])?.voxel,
    isTargetable: (voxel) => semantics.get(voxel)?.targetable === true,
    invoke: (actorId, request) =>
      options.modules().invokeActor(options.callbacks.moduleActorAuthority, actorId, request),
  });
  return Object.freeze({ runtime, targets });
}
