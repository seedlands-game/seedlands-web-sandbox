import { RegisteredStationRuntime } from './modules/registered-station-runtime';
import type { WorldComposition } from '../composition/contracts';
import { RegisteredInventoryRuntime } from './modules/registered-inventory-runtime';
import { RegisteredCombatRuntime } from './modules/registered-combat-runtime';
import { RegisteredBlockRuntime } from './modules/registered-block-runtime';
import { RegisteredFeedingRuntime } from './modules/registered-feeding-runtime';
import { RegisteredForageRuntime } from './modules/registered-forage-runtime';
import { FORAGE_WORLD_COMPONENT } from './modules/forage-model';
import type { RegisteredStructureRuntime } from './modules/registered-structure-runtime';
import type { GameplayCallbacks } from './gameplay-runtime-contracts';
import type { KernelStateOwner } from '@seedlands/kernel/execution';
import { createRegisteredGameplayStructure } from './gameplay-structure-runtime';
import type { GameplayStructureCounters } from './gameplay-structure-commit';
import type { GameplayContent } from './gameplay-content';
import type { GameplayModuleRuntime } from './modules/gameplay-module-runtime';
import type { AutonomyRuntime } from '../simulation/autonomy-runtime';

type Options = Omit<
  ConstructorParameters<typeof RegisteredInventoryRuntime>[0] &
    ConstructorParameters<typeof RegisteredCombatRuntime>[0] &
    ConstructorParameters<typeof RegisteredBlockRuntime>[0] &
    ConstructorParameters<typeof RegisteredFeedingRuntime>[0] &
    ConstructorParameters<typeof RegisteredForageRuntime>[0],
  'composition'
> & { composition?: WorldComposition };
type RegisteredOptions = Options &
  Readonly<{
    structures?: RegisteredStructureRuntime;
    structureTargets?(): import('./gameplay-structure-target-runtime').GameplayStructureTargetRuntime | null;
  }>;

/** All adapters share the same host owners and remain unavailable in standalone worlds. */
export function createGameplayRegisteredAdapters(options: RegisteredOptions) {
  if (!options.composition)
    return {
      inventory: null,
      combat: null,
      blocks: null,
      feeding: null,
      forage: null,
      stations: null,
      structures: null,
    };
  const composed = { ...options, composition: options.composition };
  return {
    inventory: new RegisteredInventoryRuntime(composed),
    combat: new RegisteredCombatRuntime(composed),
    blocks: new RegisteredBlockRuntime(composed),
    feeding: new RegisteredFeedingRuntime(composed),
    forage: options.composition.registrations.states.some(({ definition }) => definition.id === FORAGE_WORLD_COMPONENT)
      ? new RegisteredForageRuntime(composed)
      : null,
    stations: options.content.stations ? new RegisteredStationRuntime(composed) : null,
    structures: options.structures ?? null,
  };
}

export function createGameplayRegisteredRuntimes(
  options: Readonly<{
    callbacks: GameplayCallbacks;
    content: GameplayContent;
    entities: ConstructorParameters<typeof RegisteredInventoryRuntime>[0]['entities'];
    kernelState: KernelStateOwner;
    counters: GameplayStructureCounters;
    modules(): GameplayModuleRuntime;
    simulation(): AutonomyRuntime;
    actorIds(): readonly string[];
    rulesetRevision(): number;
    now(): number;
    assertCanChange(): void;
    changed(inventory?: boolean): void;
  }>,
) {
  const { callbacks } = options;
  const structure = createRegisteredGameplayStructure({
    composition: callbacks.composition,
    callbacks,
    entities: options.entities,
    kernelState: options.kernelState,
    counters: options.counters,
    simulation: options.simulation,
    modules: options.modules,
  });
  const registered = createGameplayRegisteredAdapters({
    entities: options.entities,
    content: options.content,
    actorAuthority: callbacks.moduleActorAuthority,
    modules: options.modules,
    simulation: options.simulation,
    getVoxel: callbacks.getVoxel,
    getFluidCell: callbacks.getFluidCell,
    voxelGeometry: callbacks.voxelGeometry,
    revision: () => options.kernelState.gameplayRevision,
    assertCanChange: options.assertCanChange,
    changed: options.changed,
    getLoadedVoxel: callbacks.getLoadedVoxel ?? (() => undefined),
    composition: callbacks.composition,
    actorIds: options.actorIds,
    rulesetRevision: options.rulesetRevision,
    now: options.now,
    systemAuthority: callbacks.moduleSystemAuthority,
    prepareVoxelEdit: callbacks.prepareVoxelEdit,
    structureTargets: () => structure?.targets ?? null,
    ...(structure ? { structures: structure.runtime } : {}),
  });
  return Object.freeze({ ...registered, structureTargets: structure?.targets ?? null });
}
