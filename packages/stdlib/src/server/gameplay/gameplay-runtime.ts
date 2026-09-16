import { gameplayEntityMetrics } from './gameplay-entity-metrics';
import { isActorEntityType } from './ecs-actor-state';
import type { WorldModuleBinding } from '../commands/module-command';
import { createGameplayDomainAdapters } from './gameplay-domain-adapters';
import type { ModuleInvocationValue } from '../composition/contracts';
import { createGameplayRegisteredAdapters } from './gameplay-registered-adapters';
import { BLOCK_WORLD_COMPONENT } from './modules/block-action-model';
import type { GameplayCallbacks, GameplayResult, GameplayFailure as Failure } from './gameplay-runtime-contracts';
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
import {
  EntityStore,
  type EntityQuery,
  type EntitySpawn,
  type EntityUpdate,
  type GameplayEntity,
} from './entity-store';
import type { ItemStack } from './item-registry';
import { PlayerState, type PlayerSnapshot } from './player-state';
import { type GameplayContent } from './gameplay-content';
import * as GameplaySnapshot from './gameplay-snapshot';
import { clonePosition } from './gameplay-geometry';
import type { CombatSnapshot } from './combat-runtime';
import { resolveProfiledActorSpawn } from './profiled-actor-spawn';
import { requestProfiledPlayerCombat } from './profiled-player-combat';
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

type Position = [number, number, number];
export class GameplayRuntime {
  readonly content: GameplayContent;
  readonly inventoryState: ReturnType<typeof createInventoryStatePort>;
  readonly entities: EntityStore;
  readonly simulation: AutonomyRuntime;
  readonly kernelState: KernelStateOwner;
  readonly kernelRuntime: KernelRuntime;
  readonly authorityExecution: AuthorityKernelExecutionPort;
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

  constructor(private readonly callbacks: GameplayCallbacks) {
    const resolved = resolveGameplayComposition(callbacks);
    this.content = resolved.content;
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
      needsPlayerLimit: this.needsPlayerLimit,
      installMetadata: (gameplayTime, revision) => {
        this.kernelState.restoreGameplay(gameplayTime, revision);
        this.persistedRevision = revision;
      },
    });
  }

  get hasComposition() {
    return !!this.callbacks.composition;
  }
  get resources() {
    return this.callbacks.composition?.resources ?? [];
  }
  getActorModeState(id: string) {
    return isActorEntityType(this.entities.get(id)?.type ?? 'world-item') ? this.modes.stateFor(id) : null;
  }
  acknowledgeBlockCommit(value: ModuleInvocationValue) {
    return this.registeredBlocks?.acknowledge(value);
  }
  bindModuleOperations(authorizer: WorldResourceAuthorizer, source: RegisteredActorOperationBinding) {
    return this.modules.bind(authorizer, source);
  }
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
  invokeActorModuleOperation(actorId: string, request: RegisteredOperationRequest) {
    return this.modules.invokeActor(this.callbacks.moduleActorAuthority, actorId, request);
  }
  dispose(): void {
    RuntimeLifecycle.disposeGameplayRuntime(this.schedule, this.modules);
    this.kernelRuntime.dispose();
  }

  get gameplayTime(): number {
    return this.kernelState.gameplayTime;
  }

  get gameplayRevision(): number {
    return this.kernelState.gameplayRevision;
  }

  get persistedGameplayRevision(): number {
    return this.persistedRevision;
  }

  spawn(input: EntitySpawn): GameplayEntity {
    if (input.type === 'station' || input.kind === 'station')
      throw new TypeError('Station creation requires a Block transaction.');
    if (input.type === 'player' && this.players.size >= (this.needsPlayerLimit ?? Infinity))
      throw new RangeError('Needs player membership budget exceeded.');
    if (input.archetype) this.simulation.validateActorRegistration({ archetype: input.archetype });
    const entity = this.entities.spawn(resolveProfiledActorSpawn(input, this.content.actorProfiles));
    if (entity.type === 'player')
      this.players.set(entity.id, new PlayerState(entity.id, clonePosition(entity.position), undefined, this.entities));
    if (input.archetype) this.simulation.registerActor(entity.id, { archetype: input.archetype });
    this.touch();
    return entity;
  }

  spawnPlayer(input: { id?: string; position: Position }): GameplayEntity {
    return this.spawn({ ...input, type: 'player' });
  }

  spawnWorldItem(position: Position, stack: ItemStack): GameplayEntity {
    return this.spawn({ type: 'world-item', position, stack });
  }

  spawnAutonomous(input: EntitySpawn, registration: ActorRegistration): GameplayEntity {
    return RuntimeLifecycle.spawnGameplayAutonomous(input, registration, {
      entities: this.entities,
      profiles: this.content.actorProfiles,
      simulation: this.simulation,
      changed: () => this.touch(),
    });
  }

  character(request: CharacterControlRequest, actorBinding?: CharacterActorBinding): CharacterControlResult {
    return executeGameplayCharacterRequest(this, request, actorBinding);
  }

  getEntity(id: string): GameplayEntity | null {
    return this.entities.get(id);
  }

  updateEntity(id: string, update: EntityUpdate): GameplayEntity {
    const entity = this.entities.update(id, update);
    this.touch(false);
    return entity;
  }

  updateEntityWithoutSnapshot(id: string, update: EntityUpdate): void {
    this.entities.updateWithoutSnapshot(id, update);
    this.touch(false);
  }

  updateEntitiesWithoutSnapshot(updates: readonly Readonly<{ id: string; update: EntityUpdate }>[]): void {
    commitGameplayDynamicBatch(this.entities, this.kernelState, updates);
  }

  despawnEntity(id: string): boolean {
    return RuntimeLifecycle.despawnGameplayEntity(id, this.simulation, this.entities, this.players, () => this.touch());
  }

  queryEntities(filter: EntityQuery = {}): GameplayEntity[] {
    return this.entities.query(filter);
  }

  queryNearbyEntities(position: Position, radius: number, filter: EntityQuery = {}): GameplayEntity[] {
    return this.entities.queryNearby(position, radius, filter);
  }

  getPlayerState(id: string): PlayerSnapshot {
    return this.player(id).snapshot(this.simulation.combatSnapshotFor(id));
  }

  getCombatState(id: string): CombatSnapshot {
    return this.simulation.combatSnapshotFor(id);
  }

  getInventory(id: string) {
    return this.inventoryActions.snapshot(id);
  }
  getInventoryPointerView(id: string) {
    return projectInventoryPointerView(this.entities, id);
  }
  giveItem(id: string, stack: ItemStack) {
    return this.inventoryActions.give(id, stack);
  }
  removeItem(id: string, stack: ItemStack) {
    return this.inventoryActions.remove(id, stack);
  }
  selectHotbarSlot(id: string, slot: number) {
    const state = this.getActorModeState(id);
    if (state?.mode !== 'creative') return (this.registeredInventory ?? this.inventoryActions).select(id, slot);
    if (!this.compositionGuard) return this.modes.selectCreativeSlot(id, slot);
    if (!Number.isSafeInteger(slot) || slot < 0 || slot >= 8) return { success: false, reason: 'invalid-slot' };
    const result = this.modules.invokeActor(this.callbacks.moduleActorAuthority, id, {
      operationId: 'seedlands:set-creative-catalog',
      target: { kind: 'entity', entityId: id },
      input: { slot, itemId: state.creativeCatalog.hotbar[slot] },
    });
    return result.ok ? { success: true } : { success: false, reason: result.message };
  }
  moveInventorySlot(id: string, source: number, target: number) {
    return (this.registeredInventory ?? this.inventoryActions).move(id, source, target);
  }
  inventoryPointer(id: string, input: InventoryPointerInputV1) {
    return executeInventoryPointer(
      id,
      input,
      this.registeredInventory ?? undefined,
      this.modules,
      this.callbacks.moduleActorAuthority,
    );
  }
  craft(id: string, recipeId: string) {
    return (this.registeredInventory ?? this.inventoryActions).craft(id, recipeId);
  }
  listCraftable(id: string) {
    return (this.registeredInventory ?? this.inventoryActions).listCraftable(id);
  }

  listRecipes() {
    return this.content.recipes.list();
  }

  beginBreak(id: string, position: Position): GameplayResult<{ requiredSeconds: number; commit?: WorldCommitResult }> {
    return (this.registeredBlocks ?? this.blocks).beginBreak(id, position);
  }

  cancelBreak(id: string): GameplayResult {
    return (this.registeredBlocks ?? this.blocks).cancelBreak(id);
  }

  pickupItem(playerId: string, entityId: string): GameplayResult {
    return (this.registeredInventory ?? this.inventoryActions).pickup(playerId, entityId);
  }

  dropItem(playerId: string, slot: number, count: number): GameplayResult<{ entity: GameplayEntity }> {
    return (this.registeredInventory ?? this.inventoryActions).drop(playerId, slot, count);
  }

  placeVoxel(id: string, position: Position): GameplayResult<{ commit: WorldCommitResult }> {
    return (this.registeredBlocks ?? this.blocks).placeVoxel(id, position);
  }

  useSelectedItem(id: string): GameplayResult {
    return this.useInventoryItem(id, this.entities.actorStateAccess(id).selectedSlot);
  }

  useInventoryItem(id: string, slot: number): GameplayResult {
    return (this.registeredInventory ?? this.inventoryActions).consume(id, slot);
  }

  bindFeeding(binding?: WorldModuleBinding) {
    return RuntimeLifecycle.bindRegisteredActorRequest(this.registeredFeeding, 'Feeding', binding);
  }
  bindActorCombat(binding?: WorldModuleBinding) {
    return RuntimeLifecycle.bindRegisteredActorRequest(this.registeredCombat, 'Combat', binding);
  }

  attackEntity(
    playerId: string,
    targetId: string,
  ): GameplayResult<{ actionId: string; buffered: boolean; damage?: number }> {
    const player = this.player(playerId);
    const active = this.requireAlive(player);
    if (active) return active;
    if (this.registeredCombat) return this.registeredCombat.request(playerId, targetId);
    return requestProfiledPlayerCombat(playerId, targetId, player, this.content, this.simulation, () => this.touch());
  }

  recordAuthorityMutation(): void {
    this.touch();
  }

  applyDamage(actorId: string, playerId: string, amount: number, cause: string) {
    return this.vitals.applyDamage(actorId, playerId, amount, cause);
  }
  healPlayer(playerId: string, amount: number) {
    return this.vitals.healPlayer(playerId, amount);
  }
  setHungerForDebug(playerId: string, hunger: number) {
    this.vitals.setHungerForDebug(playerId, hunger);
  }
  respawnPlayer(playerId: string) {
    return this.vitals.respawnPlayer(playerId);
  }

  advanceRules(seconds: number): { commits: WorldCommitResult[] } {
    try {
      return RuntimeLifecycle.advanceGameplayRules(seconds, {
        schedule: this.schedule,
        modules: this.modules,
        blocks: this.registeredBlocks,
        players: this.players,
        simulation: this.simulation,
        revision: () => this.kernelState.gameplayRevision,
        advancePlayer: (player, elapsed, commits) => this.advancePlayer(player, elapsed, commits),
        advanceUnscheduled: (elapsed) =>
          this.kernelState.synchronizeGameplayTime(this.kernelState.epoch, this.kernelState.gameplayTime + elapsed),
        touchWithoutEvent: () => this.touch(false),
        assertRevisionCapacity: () => this.assertRevisionCapacity(),
      });
    } finally {
      if (this.schedule) this.kernelState.synchronizeGameplayTime(this.kernelState.epoch, this.schedule.time);
    }
  }

  advanceCommitUpperBound(seconds: number): number {
    const queued = this.modules.queuedOperationCount();
    const scheduled = this.schedule?.previewCommitUpperBound(seconds) ?? 0;
    const legacyPlayers = this.schedule ? 0 : Math.ceil(seconds) * this.players.size * 2;
    const blockOperations = this.registeredBlocks?.pendingOperationUpperBound(this.modules.queuedFlushBound()) ?? 0;
    const combatOperations = this.registeredCombat?.pendingOperationUpperBound(scheduled) ?? 0;
    const registeredOperations = queued + scheduled + blockOperations + combatOperations;
    return Math.max(1, legacyPlayers + this.simulation.advanceCommitUpperBound(seconds, registeredOperations));
  }

  createSnapshot(): GameplaySnapshot.GameplaySnapshotV4 {
    return this.checkpoint.create(() => this.kernelState.gameplayRevision, this.gameplayTime);
  }

  metrics() {
    return {
      ...gameplayEntityMetrics(this.entities),
      inventoryOperationCount: this.inventoryOperationCount,
      gameplayEventCount: this.eventCount,
      snapshotBytes: this.callbacks.platform.utf8.encode(JSON.stringify(this.createSnapshot())).byteLength,
      ...this.simulation.metrics(),
    };
  }

  restoreSnapshot(raw: unknown): { version: 1 | 2 | 3 | 4; worldTime?: number } {
    return this.checkpoint.restore(raw);
  }

  markPersisted(revision: number): void {
    this.persistedRevision = Math.max(this.persistedRevision, revision);
  }

  private advancePlayer(player: PlayerState, seconds: number, commits: WorldCommitResult[]): void {
    if (player.lifecycle === 'alive' && !this.registeredBlocks)
      this.blocks.advanceBreak(player.entityId, seconds, commits);
    if (player.lifecycle === 'alive' && !this.schedule) this.vitals.advanceNeeds(player.entityId, seconds);
  }

  private player(id: string): PlayerState {
    const player = this.players.get(id);
    if (!player) throw new RangeError(`Unknown player: ${id}`);
    return player;
  }

  private requireAlive(player: Pick<PlayerState, 'lifecycle'>): Failure | null {
    return player.lifecycle === 'alive' ? null : { success: false, reason: 'player-dead' };
  }

  private assertRevisionCapacity(): void {
    if (
      !Number.isSafeInteger(this.kernelState.gameplayRevision) ||
      this.kernelState.gameplayRevision >= Number.MAX_SAFE_INTEGER
    )
      throw new RangeError('Gameplay revision capacity is exhausted.');
  }

  private touch(event = true): void {
    this.kernelState.commitGameplay(this.kernelState.epoch);
    if (event) this.eventCount += 1;
  }
}
