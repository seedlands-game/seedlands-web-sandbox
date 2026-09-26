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
import { allowsGameplayBehaviorCapability } from './gameplay-character-domain';
import type { AuthorityKernelState } from '../authority/authority-kernel-state';
import type { DifficultyRuntime } from './difficulty-runtime';
import type { EnvironmentRuntime } from './environment-runtime';
import type { ProjectileRuntime } from './projectile-runtime';
import type { LifeSkillsRuntime } from './life-skills-runtime';
import type { VehicleRuntime } from './vehicle-runtime';
import type { NavigationItemsRuntime } from './navigation-items-runtime';
import type { CropRuntime } from './crop-runtime';
import type { FinalEntitiesRuntime } from './final-entities-runtime';
import type { GameplayProgressRuntime } from './gameplay-progress-runtime';
import type { GameplaySnapshotMigration, GameplaySnapshotMigrationReport } from './gameplay-snapshot-migration';
import type { RegisteredMediaPlaybackRuntime } from './modules/registered-media-playback-runtime';

type Options = Readonly<{
  callbacks: GameplayCallbacks;
  compositionGuard: ReturnType<typeof createCompositionCheckpointGuard> | null;
  ruleset: ReturnType<typeof createWorldRulesetState>;
  schedule: ReturnType<typeof createGameplayModuleSchedule> | null;
  modules: GameplayModuleRuntime;
  registeredCombat: RegisteredCombatRuntime | null;
  registeredBlocks: RegisteredBlockRuntime | null;
  registeredMedia: RegisteredMediaPlaybackRuntime | null;
  behaviorCapabilities: BehaviorCapabilityRegistry | null;
  content: GameplayContent;
  entities: EntityStore;
  simulation: AutonomyRuntime;
  players: Map<string, PlayerState>;
  authorityState: AuthorityKernelState;
  difficulty: DifficultyRuntime;
  environment: EnvironmentRuntime;
  projectiles: ProjectileRuntime;
  lifeSkills: LifeSkillsRuntime;
  vehicles: VehicleRuntime;
  navigationItems: NavigationItemsRuntime;
  crops: CropRuntime;
  finalEntities: FinalEntitiesRuntime;
  progress: GameplayProgressRuntime;
  snapshotMigration: GameplaySnapshotMigration | null;
  needsPlayerLimit?: number;
  installMetadata(gameplayTime: number, revision: number): void;
}>;

export class GameplayRuntimeCheckpoint {
  private lastMigrationReports: readonly GameplaySnapshotMigrationReport[] = [];

  constructor(private readonly options: Options) {}

  get migrationReports(): readonly GameplaySnapshotMigrationReport[] {
    return this.lastMigrationReports;
  }

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
      this.options.authorityState,
      this.options.difficulty.checkpoint(),
      this.options.environment.checkpoint(),
      this.options.projectiles.checkpoint(),
      this.options.lifeSkills.checkpoint(),
      this.options.vehicles.checkpoint(),
      this.options.navigationItems.checkpoint(),
      this.options.crops.checkpoint(),
      this.options.finalEntities.checkpoint(),
      this.options.progress.checkpoint(),
    );
    if (this.options.compositionGuard) snapshot.composition = this.options.compositionGuard.snapshot();
    const ruleset = this.options.ruleset.snapshot();
    if (ruleset) snapshot.ruleset = ruleset;
    if (moduleSchedule) snapshot.moduleSchedule = moduleSchedule;
    if (this.options.registeredMedia) snapshot.media = this.options.registeredMedia.checkpoint();
    return snapshot;
  }

  restore(
    raw: unknown,
    options: Readonly<{ deferMediaWorldValidation?: boolean }> = {},
  ): { version: 1 | 2 | 3 | 4; worldTime?: number } {
    const { callbacks } = this.options;
    GameplaySnapshot.validateGameplaySnapshotHeader(raw);
    const migrated = this.options.snapshotMigration
      ? this.options.snapshotMigration.migrate(callbacks.platform.clone(raw), {
          targetComposition: this.options.compositionGuard?.snapshot() ?? null,
        })
      : { snapshot: raw, reports: [] as const };
    GameplaySnapshot.validateGameplaySnapshotHeader(migrated.snapshot);
    this.options.compositionGuard?.validateGameplay(migrated.snapshot);
    this.options.ruleset.validateGameplay(migrated.snapshot);
    if (
      !this.options.compositionGuard &&
      migrated.snapshot &&
      typeof migrated.snapshot === 'object' &&
      'composition' in migrated.snapshot
    )
      throw new TypeError('Gameplay composition requires a matching composed host.');
    const installSchedule = this.options.schedule?.prepareRestore(migrated.snapshot);
    if (
      !this.options.schedule &&
      migrated.snapshot &&
      typeof migrated.snapshot === 'object' &&
      'moduleSchedule' in migrated.snapshot
    )
      throw new TypeError('Gameplay module schedule requires a composed host.');
    const mediaRaw =
      migrated.snapshot && typeof migrated.snapshot === 'object' && 'media' in migrated.snapshot
        ? migrated.snapshot.media
        : undefined;
    if (!this.options.registeredMedia && mediaRaw !== undefined)
      throw new TypeError('Gameplay media checkpoint requires a composed Media owner.');
    const media = this.options.registeredMedia?.prepareCheckpointCandidate(mediaRaw, {
      deferDeviceValidation: options.deferMediaWorldValidation,
    });
    const restored = GameplaySnapshot.restoreGameplayRuntimeSnapshot(migrated.snapshot, {
      getVoxel: (x, y, z) => callbacks.getVoxel([x, y, z]) ?? Voxel.Stone,
      getWorldTime: callbacks.getWorldTime,
      clone: callbacks.platform.clone,
      items: this.options.content.items,
      stationCodec: this.options.content.stations?.codec,
      playerLayout: this.options.entities.playerLayout,
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
      ...(this.options.behaviorCapabilities && callbacks.composition
        ? {
            allowsBehaviorCapability: (actorId, kind, capability) =>
              allowsGameplayBehaviorCapability(
                {
                  composition: callbacks.composition!,
                  capabilities: this.options.behaviorCapabilities!,
                  actorAuthority: callbacks.moduleActorAuthority,
                },
                actorId,
                kind,
                capability,
              ),
          }
        : {}),
      simulation: this.options.simulation,
      players: this.options.players,
      authorityState: this.options.authorityState,
      installMetadata: this.options.installMetadata,
    });
    this.options.difficulty.restore(
      migrated.snapshot && typeof migrated.snapshot === 'object' && 'difficulty' in migrated.snapshot
        ? (migrated.snapshot.difficulty as import('./difficulty-runtime').DifficultyCheckpoint)
        : undefined,
    );
    if (
      migrated.snapshot &&
      typeof migrated.snapshot === 'object' &&
      'environment' in migrated.snapshot &&
      migrated.snapshot.environment
    )
      this.options.environment.restore(
        migrated.snapshot.environment as import('./environment-runtime').EnvironmentCheckpoint,
      );
    this.options.projectiles.restore(
      migrated.snapshot && typeof migrated.snapshot === 'object' && 'projectiles' in migrated.snapshot
        ? (migrated.snapshot.projectiles as import('./projectile-runtime').ProjectileCheckpoint)
        : undefined,
    );
    this.options.lifeSkills.restore(
      migrated.snapshot && typeof migrated.snapshot === 'object' && 'lifeSkills' in migrated.snapshot
        ? (migrated.snapshot.lifeSkills as import('./life-skills-runtime').LifeSkillsCheckpoint)
        : undefined,
    );
    this.options.vehicles.restore(
      migrated.snapshot && typeof migrated.snapshot === 'object' && 'vehicles' in migrated.snapshot
        ? (migrated.snapshot.vehicles as import('./vehicle-runtime').VehicleCheckpoint)
        : undefined,
    );
    this.options.navigationItems.restore(
      migrated.snapshot && typeof migrated.snapshot === 'object' && 'navigationItems' in migrated.snapshot
        ? (migrated.snapshot.navigationItems as import('./navigation-items-runtime').NavigationItemsCheckpoint)
        : undefined,
    );
    this.options.crops.restore(
      migrated.snapshot && typeof migrated.snapshot === 'object' && 'crops' in migrated.snapshot
        ? (migrated.snapshot.crops as import('./crop-runtime').CropCheckpoint)
        : undefined,
    );
    this.options.finalEntities.restore(
      migrated.snapshot && typeof migrated.snapshot === 'object' && 'finalEntities' in migrated.snapshot
        ? (migrated.snapshot.finalEntities as import('./final-entities-runtime').FinalEntitiesCheckpoint)
        : undefined,
    );
    this.options.progress.restore(
      migrated.snapshot && typeof migrated.snapshot === 'object' && 'progress' in migrated.snapshot
        ? (migrated.snapshot.progress as import('./gameplay-progress-runtime').GameplayProgressCheckpoint)
        : undefined,
    );
    media?.validate();
    media?.apply();
    installSchedule?.();
    this.lastMigrationReports = Object.freeze(
      migrated.reports.map((report) =>
        Object.freeze({ id: report.id, removedActorIds: Object.freeze([...report.removedActorIds]) }),
      ),
    );
    this.options.modules.clearBindings();
    this.options.registeredBlocks?.takeCommits();
    return restored;
  }
}
