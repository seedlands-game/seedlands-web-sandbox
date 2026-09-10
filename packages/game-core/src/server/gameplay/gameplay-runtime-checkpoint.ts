import type { BehaviorCapabilityRegistry } from '../composition/behavior-capability-registry';
import type { createCompositionCheckpointGuard } from '../composition/checkpoint-identity';
import type { GameplayCallbacks } from './gameplay-runtime-contracts';
import * as GameplaySnapshot from './gameplay-snapshot';
import type { GameplayContent } from './gameplay-content';
import type { EntityStore } from './entity-store';
import type { PlayerState } from './player-state';
import type { AutonomyRuntime } from '../simulation/autonomy-runtime';
import type { RegisteredCombatRuntime } from './modules/registered-combat-runtime';
import type { RegisteredBlockRuntime } from './modules/registered-block-runtime';
import type { GameplayModuleRuntime } from './modules/gameplay-module-runtime';
import type { createGameplayModuleSchedule } from './modules/gameplay-module-schedule';
import type { createWorldRulesetState } from './modules/world-ruleset-state';
import { BLOCK_WORLD_COMPONENT } from './modules/block-action-model';
import { Voxel } from '../../world/voxel';

type Options = Readonly<{
  callbacks: GameplayCallbacks;
  compositionGuard: ReturnType<typeof createCompositionCheckpointGuard> | null;
  ruleset: ReturnType<typeof createWorldRulesetState>;
  schedule: ReturnType<typeof createGameplayModuleSchedule> | null;
  modules: GameplayModuleRuntime;
  registeredCombat: RegisteredCombatRuntime | null;
  registeredBlocks: RegisteredBlockRuntime | null;
  behaviorCapabilities: BehaviorCapabilityRegistry | null;
  content: GameplayContent;
  entities: EntityStore;
  simulation: AutonomyRuntime;
  players: Map<string, PlayerState>;
  needsPlayerLimit?: number;
  installMetadata(gameplayTime: number, revision: number): void;
}>;

export class GameplayRuntimeCheckpoint {
  constructor(private readonly options: Options) {}

  create(revision: () => number, gameplayTime: number): GameplaySnapshot.GameplaySnapshotV4 {
    this.options.modules.prepareSnapshot();
    this.options.registeredCombat?.drain();
    this.options.modules.prepareSnapshot();
    this.options.registeredCombat?.drain();
    const moduleSchedule = this.options.schedule?.snapshot();
    const snapshot = GameplaySnapshot.createGameplaySnapshotV4(
      revision(),
      gameplayTime,
      this.options.callbacks.getWorldTime(),
      this.options.entities.exportComponentSnapshot(),
      this.options.simulation.snapshot(),
    );
    if (this.options.compositionGuard) snapshot.composition = this.options.compositionGuard.snapshot();
    const ruleset = this.options.ruleset.snapshot();
    if (ruleset) snapshot.ruleset = ruleset;
    if (moduleSchedule) snapshot.moduleSchedule = moduleSchedule;
    return snapshot;
  }

  restore(raw: unknown): { version: 1 | 2 | 3 | 4; worldTime?: number } {
    const { callbacks } = this.options;
    this.options.compositionGuard?.validateGameplay(raw);
    this.options.ruleset.validateGameplay(raw);
    if (!this.options.compositionGuard && raw && typeof raw === 'object' && 'composition' in raw)
      throw new TypeError('Gameplay composition requires a matching composed host.');
    const installSchedule = this.options.schedule?.prepareRestore(raw);
    if (!this.options.schedule && raw && typeof raw === 'object' && 'moduleSchedule' in raw)
      throw new TypeError('Gameplay module schedule requires a composed host.');
    const restored = GameplaySnapshot.restoreGameplayRuntimeSnapshot(raw, {
      getVoxel: (x, y, z) => callbacks.getVoxel([x, y, z]) ?? Voxel.Stone,
      getWorldTime: callbacks.getWorldTime,
      clone: callbacks.platform.clone,
      items: this.options.content.items,
      stationCodec: this.options.content.stations?.codec,
      meleeDefinitions: this.options.content.meleeDefinitions,
      actorProfiles: this.options.content.actorProfiles,
      entities: this.options.entities,
      registeredNeeds: !!this.options.schedule,
      registeredFeeding: !!callbacks.composition,
      registeredBlocks: callbacks.composition?.registrations.states.some(
        ({ definition }) => definition.id === BLOCK_WORLD_COMPONENT,
      ),
      combatOriginFor: this.options.registeredCombat
        ? (entities) => this.options.registeredCombat!.originFor(entities)
        : undefined,
      needsPlayerLimit: this.options.needsPlayerLimit,
      ...(this.options.behaviorCapabilities ? { behaviorCapabilities: this.options.behaviorCapabilities } : {}),
      simulation: this.options.simulation,
      players: this.options.players,
      installMetadata: this.options.installMetadata,
    });
    installSchedule?.();
    this.options.modules.clearBindings();
    this.options.registeredBlocks?.takeCommits();
    return restored;
  }
}
