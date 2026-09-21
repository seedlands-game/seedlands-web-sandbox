import { isActorEntityType } from './ecs-actor-state';
import type { WorldModuleBinding } from '../commands/module-command';
import { createGameplayDomainAdapters } from './gameplay-domain-adapters';
import type { ModuleInvocationValue } from '../composition/contracts';
import { createGameplayRegisteredAdapters } from './gameplay-registered-adapters';
import { BLOCK_WORLD_COMPONENT } from './modules/block-action-model';
import type { GameplayCallbacks, GameplayResult } from './gameplay-runtime-contracts';
export type * from './gameplay-runtime-contracts';
import type { RegisteredCombatRuntime } from './modules/registered-combat-runtime';
import type { RegisteredFeedingRuntime } from './modules/registered-feeding-runtime';
import { COMBAT_REQUEST_OPERATION } from './modules/combat-model';
import { NEEDS_COMPONENT } from './modules/needs-model';
import { createNeedsStatePort } from './modules/needs-state-port';
import { createGameplayModuleSchedule } from './modules/gameplay-module-schedule';
import { createWorldRulesetState } from './modules/world-ruleset-state';
import { ModeRuntime } from './modules/mode-runtime';
import { createModeStatePort } from './modules/mode-state-port';
import { GameplayModuleRuntime } from './modules/gameplay-module-runtime';
import { findGameplayModeLanding } from './gameplay-mode-landing';
import type { WorldResourceAuthorizer } from '../harness/world-authorization';
import type { RegisteredActorOperationBinding, RegisteredOperationRequest } from '../composition/operation-contracts';
import { createInventoryStatePort } from './modules/inventory-state-port';
import { resolveGameplayComposition } from '../composition/gameplay-composition';
import type { WorldCommitResult } from '../game-server';
import { AutonomyRuntime, type ActorRegistration } from '../simulation/autonomy-runtime';
import { EntityStore } from './entity-store';
import type { EntityQuery, EntitySpawn, EntityUpdate, GameplayEntity } from './entity-store';
import type { ItemStack } from './item-registry';
import { PlayerState, type PlayerSnapshot } from './player-state';
import { type GameplayContent } from './gameplay-content';
import { createPlayerCombatRequest } from './profiled-player-combat';
import type { InventoryPointerInputV1 } from './modules/inventory-pointer-contract';
import { executeInventoryPointer, projectInventoryPointerView } from './gameplay-inventory-pointer';
import * as RuntimeLifecycle from './gameplay-runtime-lifecycle';
import {
  BEHAVIOR_REGISTRY_CAPABILITY,
  type BehaviorCapabilityRegistry,
} from '../composition/behavior-capability-registry';
import type {
  CharacterActorBinding,
  CharacterControlRequest,
  CharacterControlResult,
} from '../../runtime/character-control-protocol';
import { executeGameplayCharacterRequest } from './gameplay-character-control';
import { GameplayRuntimeCheckpoint } from './gameplay-runtime-checkpoint';
import type { KernelRuntime, KernelStateOwner } from '@seedlands/kernel/execution';
import { createGameplayAutonomyRuntime } from './gameplay-autonomy-runtime';
import { createGameplayKernelRuntime } from './gameplay-kernel-runtime';
import {
  createAuthorityKernelExecutionPort,
  type AuthorityKernelExecutionPort,
} from '../authority/authority-kernel-state';
import { commitGameplayDynamicBatch } from './gameplay-dynamic-batch';
import { createGameplayHotbarSelection } from './gameplay-inventory-selection';
import { GameplayEnvironmentFacade } from './gameplay-environment-facade';
import { collectGameplayRuntimeMetrics } from './gameplay-runtime-metrics';
import { DifficultyRuntime, type Difficulty } from './difficulty-runtime';
import { applySurvivalDamage, changeDifficulty, equipArmor, useSelectedBed } from './gameplay-survival-settings';
import { EnvironmentRuntime } from './environment-runtime';
import { createGameplayEnvironmentAdvancer } from './gameplay-environment-coordinator';
import type { ProjectileVector } from './projectile-runtime';
import { createGameplayWorldSystems } from './gameplay-world-systems';
import { assertGameplayRevisionCapacity } from './gameplay-revision-capacity';

type Position = [number, number, number];
export class GameplayRuntime {
  readonly content: GameplayContent;
  readonly inventoryState: ReturnType<typeof createInventoryStatePort>;
  readonly entities: EntityStore;
  readonly simulation: AutonomyRuntime;
  readonly kernelState: KernelStateOwner;
  readonly kernelRuntime: KernelRuntime;
  readonly authorityExecution: AuthorityKernelExecutionPort;
  readonly difficulty = new DifficultyRuntime();
  readonly environment: EnvironmentRuntime;
  readonly environmentQueries: GameplayEnvironmentFacade;
  readonly projectiles;
  private readonly players = new Map<string, PlayerState>();
  private persistedRevision = 0;
  private inventoryOperationCount = 0;
  private eventCount = 0;
  private readonly behaviorCapabilities: BehaviorCapabilityRegistry | null;
  private readonly compositionGuard;
  private readonly inventoryActions;
  private readonly registeredInventory;
  private readonly modes;
  private readonly vitals;
  private readonly modules: GameplayModuleRuntime;
  private readonly blocks;
  private readonly registeredBlocks;
  private readonly ruleset;
  private readonly schedule;
  private readonly needsPlayerLimit;
  private readonly registeredFeeding: RegisteredFeedingRuntime | null;
  private readonly registeredCombat: RegisteredCombatRuntime | null;
  private readonly checkpoint: GameplayRuntimeCheckpoint;
  readonly speciesInteractions;
  readonly lifeSkills;
  readonly vehicles;
  readonly navigationItems;
  readonly crops;
  readonly structures;
  readonly finalEntities;
  readonly specialDamage;
  private readonly selectHotbar;
  private readonly requestPlayerCombat;
  private readonly advanceWorldRules;

  constructor(private readonly callbacks: GameplayCallbacks) {
    const resolved = resolveGameplayComposition(callbacks);
    this.content = resolved.content;
    this.environment = new EnvironmentRuntime(callbacks.environmentSeed ?? 0);
    this.environmentQueries = new GameplayEnvironmentFacade(this, callbacks);
    const kernel = createGameplayKernelRuntime(this.content, callbacks.composition, callbacks.worldId);
    this.kernelRuntime = kernel.runtime;
    this.kernelState = kernel.runtime.stateOwner;
    this.authorityExecution = createAuthorityKernelExecutionPort(this.kernelState, kernel.authority);
    this.needsPlayerLimit = callbacks.composition?.registrations.states.some(
      ({ definition }) => definition.id === NEEDS_COMPONENT || definition.id === BLOCK_WORLD_COMPONENT,
    )
      ? 128
      : undefined;
    this.ruleset = createWorldRulesetState(callbacks.composition);
    this.compositionGuard = resolved.guard;
    this.entities = kernel.entities;
    this.inventoryState = createInventoryStatePort({
      entities: this.entities,
      items: this.content.items,
      revision: () => this.kernelState.gameplayRevision,
      assertCanChange: () => this.assertRevisionCapacity(),
      prepareCancellation: (ids) => this.simulation.prepareCancellation(ids, 'slot-changed'),
      changed: () => this.touch(),
    });
    const adapters = createGameplayDomainAdapters({
      entities: this.entities,
      content: this.content,
      callbacks,
      player: (id) => this.player(id),
      simulation: () => this.simulation,
      assertCanChange: () => this.assertRevisionCapacity(),
      changed: (inventory, event) => {
        if (inventory) this.inventoryOperationCount++;
        this.touch(event);
      },
    });
    this.inventoryActions = adapters.inventory;
    this.vitals = adapters.vitals;
    this.blocks = adapters.blocks;
    const registeredPorts = {
      entities: this.entities,
      content: this.content,
      actorAuthority: callbacks.moduleActorAuthority,
      modules: () => this.modules,
      simulation: () => this.simulation,
      getVoxel: callbacks.getVoxel,
      revision: () => this.kernelState.gameplayRevision,
      assertCanChange: () => this.assertRevisionCapacity(),
      changed: (inventory = false) => {
        if (inventory) this.inventoryOperationCount++;
        this.touch();
      },
    };
    const registered = createGameplayRegisteredAdapters({
      ...registeredPorts,
      getLoadedVoxel: callbacks.getLoadedVoxel ?? (() => undefined),
      composition: callbacks.composition,
      actorIds: () => [...this.players.keys(), ...this.simulation.actorIds()],
      rulesetRevision: () => this.ruleset.snapshot()?.revision ?? 0,
      now: () => this.gameplayTime,
      systemAuthority: callbacks.moduleSystemAuthority,
      prepareVoxelEdit: callbacks.prepareVoxelEdit,
    });
    this.registeredInventory = registered.inventory;
    this.registeredCombat = registered.combat;
    this.registeredBlocks = registered.blocks;
    this.registeredFeeding = registered.feeding;
    this.modes = new ModeRuntime({
      entities: this.entities,
      findSafeLanding: (id) =>
        findGameplayModeLanding(this.entities.get(id)!, callbacks.getVoxel, this.kernelState.gameplayRevision),
      assertCanChange: () => this.assertRevisionCapacity(),
      prepareCancelIncompatibleActions: (id, reason) => this.simulation.prepareInterruption(id, reason),
      changed: () => this.touch(),
    });
    this.modules = new GameplayModuleRuntime({
      combat: this.registeredCombat?.state,
      blocks: this.registeredBlocks?.state,
      feeding: this.registeredFeeding?.state,
      forage: registered.forage?.state,
      stations: registered.stations?.state,
      composition: callbacks.composition,
      entities: this.entities,
      clone: callbacks.platform.clone,
      inventory: this.inventoryState,
      inventoryActions: this.registeredInventory?.state,
      ruleset: this.ruleset.port,
      needs: createNeedsStatePort({
        entities: this.entities,
        actorIds: () => [...this.players.keys(), ...this.simulation.actorIds()],
        revision: () => this.kernelState.gameplayRevision,
        assertCanChange: () => this.assertRevisionCapacity(),
        changed: () => this.touch(),
        prepareDeaths: (ids) => this.simulation.prepareDeaths(ids),
      }),
      mode: createModeStatePort(this.entities, this.modes, () => this.kernelState.gameplayRevision),
    });
    this.schedule = callbacks.composition
      ? createGameplayModuleSchedule(callbacks.composition, this.modules, callbacks.moduleSystemAuthority, () => {
          this.registeredCombat?.drain();
        })
      : null;
    this.behaviorCapabilities = callbacks.composition?.definitionMap.capabilities.some(
      ({ id }) => id === BEHAVIOR_REGISTRY_CAPABILITY,
    )
      ? callbacks.composition.capability<BehaviorCapabilityRegistry>(BEHAVIOR_REGISTRY_CAPABILITY)
      : null;
    this.simulation = createGameplayAutonomyRuntime({
      callbacks,
      entities: this.entities,
      players: this.players,
      content: this.content,
      modules: this.modules,
      behaviorCapabilities: this.behaviorCapabilities,
      registeredCombat: this.registeredCombat,
      vitals: this.vitals,
      assertCanChange: () => this.assertRevisionCapacity(),
      changed: () => this.touch(),
      simulation: () => this.simulation,
    });
    const systems = createGameplayWorldSystems({
      callbacks,
      content: this.content,
      entities: this.entities,
      players: this.players,
      simulation: () => this.simulation,
      vitals: this.vitals,
      environment: this.environment,
      assertCanChange: () => this.assertRevisionCapacity(),
      changed: () => this.touch(),
      despawn: (id) => this.despawnEntity(id),
      spawn: (input, registration) => this.spawnAutonomous(input, registration),
    });
    this.projectiles = systems.projectiles;
    this.speciesInteractions = systems.speciesInteractions;
    this.lifeSkills = systems.lifeSkills;
    this.vehicles = systems.vehicles;
    this.navigationItems = systems.navigationItems;
    this.crops = systems.crops;
    this.structures = systems.structures;
    this.finalEntities = systems.finalEntities;
    this.specialDamage = systems.specialDamage;
    this.selectHotbar = createGameplayHotbarSelection({
      state: (id) => this.getActorModeState(id),
      inventory: this.registeredInventory ?? this.inventoryActions,
      hasCompositionGuard: !!this.compositionGuard,
      modes: this.modes,
      modules: this.modules,
      actorAuthority: this.callbacks.moduleActorAuthority,
    });
    this.requestPlayerCombat = createPlayerCombatRequest({
      player: (id) => this.player(id),
      content: this.content,
      simulation: this.simulation,
      registered: this.registeredCombat,
      changed: () => this.touch(),
    });
    this.advanceWorldRules = createGameplayEnvironmentAdvancer({
      schedule: this.schedule,
      modules: this.modules,
      blocks: this.registeredBlocks,
      combat: this.registeredCombat,
      players: this.players,
      simulation: this.simulation,
      revision: () => this.kernelState.gameplayRevision,
      advancePlayer: (player, elapsed, commits) =>
        RuntimeLifecycle.advanceGameplayPlayer(
          player,
          elapsed,
          commits,
          this.blocks,
          this.vitals,
          this.registeredBlocks,
          this.schedule,
        ),
      advanceUnscheduled: (elapsed) =>
        this.kernelState.synchronizeGameplayTime(this.kernelState.epoch, this.kernelState.gameplayTime + elapsed),
      touchWithoutEvent: () => this.touch(false),
      assertRevisionCapacity: () => this.assertRevisionCapacity(),
      environment: this.environment,
      callbacks: this.callbacks,
      voxels: this.content.voxelGameplay,
      entities: this.entities,
      damage: (source, target, amount, cause) => this.applyDamage(source, target, amount, cause),
      despawn: (id) => this.despawnEntity(id),
      synchronizeSchedule: () => {
        if (this.schedule) this.kernelState.synchronizeGameplayTime(this.kernelState.epoch, this.schedule.time);
      },
      afterAdvance: (seconds) => {
        this.projectiles.advance(seconds);
        this.lifeSkills.advance(seconds);
        this.vehicles.advance(seconds);
        this.crops.advance(seconds);
        this.finalEntities.advance(seconds);
        this.environmentQueries.advanceNaturalSpawns(seconds);
      },
    });
    this.checkpoint = new GameplayRuntimeCheckpoint({
      callbacks,
      compositionGuard: this.compositionGuard,
      ruleset: this.ruleset,
      schedule: this.schedule,
      modules: this.modules,
      registeredCombat: this.registeredCombat,
      registeredBlocks: this.registeredBlocks,
      behaviorCapabilities: this.behaviorCapabilities,
      content: this.content,
      entities: this.entities,
      simulation: this.simulation,
      players: this.players,
      authorityState: kernel.authority,
      difficulty: this.difficulty,
      environment: this.environment,
      projectiles: this.projectiles,
      lifeSkills: this.lifeSkills,
      vehicles: this.vehicles,
      navigationItems: this.navigationItems,
      crops: this.crops,
      finalEntities: this.finalEntities,
      needsPlayerLimit: this.needsPlayerLimit,
      installMetadata: (gameplayTime, revision) => {
        this.kernelState.restoreGameplay(gameplayTime, revision);
        this.persistedRevision = revision;
      },
    });
  }

  getActorModeState = (id: string) =>
    isActorEntityType(this.entities.get(id)?.type ?? 'world-item') ? this.modes.stateFor(id) : null;
  acknowledgeBlockCommit = (value: ModuleInvocationValue) => this.registeredBlocks?.acknowledge(value);
  bindModuleOperations = (authorizer: WorldResourceAuthorizer, source: RegisteredActorOperationBinding) =>
    this.modules.bind(authorizer, source);
  invokeModuleOperation(
    authorizer: WorldResourceAuthorizer,
    source: Omit<RegisteredActorOperationBinding, 'moduleId'>,
    request: RegisteredOperationRequest,
  ) {
    const operationId = request.operationId;
    const result = this.modules.invoke(authorizer, source, request);
    if (result.ok && operationId === COMBAT_REQUEST_OPERATION) this.registeredCombat?.drain();
    return result;
  }
  invokeActorModuleOperation = (actorId: string, request: RegisteredOperationRequest) =>
    this.modules.invokeActor(this.callbacks.moduleActorAuthority, actorId, request);
  dispose = (): void => {
    RuntimeLifecycle.disposeGameplayRuntime(this.schedule, this.modules);
    this.kernelRuntime.dispose();
  };

  get gameplayTime(): number {
    return this.kernelState.gameplayTime;
  }
  get gameplayRevision(): number {
    return this.kernelState.gameplayRevision;
  }
  get persistedGameplayRevision(): number {
    return this.persistedRevision;
  }

  spawn = (input: EntitySpawn): GameplayEntity =>
    RuntimeLifecycle.spawnGameplayEntity(input, {
      entities: this.entities,
      profiles: this.content.actorProfiles,
      simulation: this.simulation,
      players: this.players,
      playerLimit: this.needsPlayerLimit,
      changed: () => this.touch(),
    });

  spawnPlayer = (input: { id?: string; position: Position }): GameplayEntity =>
    this.spawn({ ...input, type: 'player' });
  spawnWorldItem = (position: Position, stack: ItemStack): GameplayEntity =>
    this.spawn({ type: 'world-item', position, stack });

  spawnAutonomous(input: EntitySpawn, registration: ActorRegistration): GameplayEntity {
    return RuntimeLifecycle.spawnGameplayAutonomous(input, registration, {
      entities: this.entities,
      profiles: this.content.actorProfiles,
      simulation: this.simulation,
      changed: () => this.touch(),
    });
  }

  character = (request: CharacterControlRequest, actorBinding?: CharacterActorBinding): CharacterControlResult =>
    executeGameplayCharacterRequest(this, request, actorBinding);

  getEntity = (id: string): GameplayEntity | null => this.entities.get(id);

  updateEntity(id: string, update: EntityUpdate): GameplayEntity {
    const entity = this.entities.update(id, update);
    this.touch(false);
    return entity;
  }

  updateEntityWithoutSnapshot = (id: string, update: EntityUpdate): void =>
    void (this.entities.updateWithoutSnapshot(id, update), this.touch(false));
  updateEntitiesWithoutSnapshot = (updates: readonly Readonly<{ id: string; update: EntityUpdate }>[]): void =>
    commitGameplayDynamicBatch(this.entities, this.kernelState, updates);
  despawnEntity = (id: string): boolean =>
    RuntimeLifecycle.despawnGameplayEntity(id, this.simulation, this.entities, this.players, () => this.touch());

  queryEntities = (filter: EntityQuery = {}): GameplayEntity[] => this.entities.query(filter);
  queryNearbyEntities = (position: Position, radius: number, filter: EntityQuery = {}): GameplayEntity[] =>
    this.entities.queryNearby(position, radius, filter);

  getPlayerState = (id: string): PlayerSnapshot => this.player(id).snapshot(this.simulation.combatSnapshotFor(id));

  getCombatState = (id: string) => this.simulation.combatSnapshotFor(id);

  getInventory = (id: string) => this.inventoryActions.snapshot(id);
  getInventoryPointerView = (id: string) => projectInventoryPointerView(this.entities, id);
  giveItem = (id: string, stack: ItemStack) => this.inventoryActions.give(id, stack);
  removeItem = (id: string, stack: ItemStack) => this.inventoryActions.remove(id, stack);
  selectHotbarSlot = (id: string, slot: number) => this.selectHotbar(id, slot);
  moveInventorySlot = (id: string, source: number, target: number) =>
    (this.registeredInventory ?? this.inventoryActions).move(id, source, target);
  inventoryPointer(id: string, input: InventoryPointerInputV1) {
    return executeInventoryPointer(
      id,
      input,
      this.registeredInventory ?? undefined,
      this.modules,
      this.callbacks.moduleActorAuthority,
    );
  }
  craft = (id: string, recipeId: string) => (this.registeredInventory ?? this.inventoryActions).craft(id, recipeId);
  listCraftable = (id: string) => (this.registeredInventory ?? this.inventoryActions).listCraftable(id);
  listRecipes = () => this.content.recipes.list();
  beginBreak = (id: string, position: Position) => (this.registeredBlocks ?? this.blocks).beginBreak(id, position);
  cancelBreak = (id: string): GameplayResult => (this.registeredBlocks ?? this.blocks).cancelBreak(id);
  pickupItem = (playerId: string, entityId: string): GameplayResult =>
    (this.registeredInventory ?? this.inventoryActions).pickup(playerId, entityId);
  dropItem = (playerId: string, slot: number, count: number) =>
    (this.registeredInventory ?? this.inventoryActions).drop(playerId, slot, count);
  placeVoxel = (id: string, position: Position) => (this.registeredBlocks ?? this.blocks).placeVoxel(id, position);
  useFluidContainer = (id: string, position: Position) => this.blocks.useFluidContainer(id, position);

  useSelectedItem = (id: string) =>
    (this.registeredInventory ?? this.inventoryActions).consume(id, this.entities.actorStateAccess(id).selectedSlot);
  fireSelectedRangedItem = (id: string, direction: ProjectileVector) => this.projectiles.fireSelected(id, direction);

  useInventoryItem = (id: string, slot: number): GameplayResult =>
    (this.registeredInventory ?? this.inventoryActions).consume(id, slot);

  bindFeeding(binding?: WorldModuleBinding) {
    return RuntimeLifecycle.bindRegisteredActorRequest(this.registeredFeeding, 'Feeding', binding);
  }
  bindActorCombat(binding?: WorldModuleBinding) {
    return RuntimeLifecycle.bindRegisteredActorRequest(this.registeredCombat, 'Combat', binding);
  }

  attackEntity = (
    playerId: string,
    targetId: string,
  ): GameplayResult<{ actionId: string; buffered: boolean; damage?: number }> =>
    this.requestPlayerCombat(playerId, targetId);

  recordAuthorityMutation = (): void => this.touch();

  applyDamage = (actorId: string, playerId: string, amount: number, cause: string) =>
    applySurvivalDamage(
      this.difficulty,
      this.simulation,
      this.entities.actorStateAccess(playerId),
      this.content.items,
      actorId,
      amount,
      (adjusted) => this.vitals.applyDamage(actorId, playerId, adjusted, cause),
    );
  equipSelectedArmor = (playerId: string) =>
    equipArmor(this.entities.actorStateAccess(playerId), this.content.items, () => this.touch());
  setDifficulty = (value: Difficulty, expectedRevision?: number) =>
    changeDifficulty(
      this.difficulty,
      this.simulation,
      value,
      expectedRevision,
      (id) => this.despawnEntity(id),
      () => this.touch(),
    );
  setSpawnFromSelectedBed = (playerId: string, bedPosition: Position) =>
    useSelectedBed(this.player(playerId), bedPosition, this.callbacks, () => this.touch());
  igniteEnvironment = (position: Position, seconds?: number) => this.environment.ignite(position, seconds);
  primeEnvironmentTnt = (position: Position, fuseSeconds?: number, power?: number) =>
    this.environment.primeTnt(position, fuseSeconds, power);
  healPlayer = (playerId: string, amount: number) => this.vitals.healPlayer(playerId, amount);
  setHungerForDebug = (playerId: string, hunger: number) => this.vitals.setHungerForDebug(playerId, hunger);
  respawnPlayer = (playerId: string) => this.vitals.respawnPlayer(playerId);
  advanceRules = (seconds: number): { commits: WorldCommitResult[] } => this.advanceWorldRules.advance(seconds);
  advanceCommitUpperBound = (seconds: number): number => this.advanceWorldRules.commitUpperBound(seconds);
  createSnapshot = () => this.checkpoint.create(() => this.kernelState.gameplayRevision, this.gameplayTime);
  metrics() {
    return collectGameplayRuntimeMetrics({
      entities: this.entities,
      simulation: this.simulation,
      inventoryOperationCount: this.inventoryOperationCount,
      gameplayEventCount: this.eventCount,
      platform: this.callbacks.platform,
      snapshot: this.createSnapshot,
    });
  }
  restoreSnapshot = (raw: unknown) => this.checkpoint.restore(raw);
  markPersisted = (revision: number): void =>
    void (this.persistedRevision = Math.max(this.persistedRevision, revision));
  private player = (id: string): PlayerState => RuntimeLifecycle.requireGameplayPlayer(this.players, id);
  private assertRevisionCapacity = (): void => assertGameplayRevisionCapacity(this.kernelState.gameplayRevision);
  private touch(event = true): void {
    this.kernelState.commitGameplay(this.kernelState.epoch);
    if (event) this.eventCount += 1;
  }
}
