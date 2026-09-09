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
import { Voxel } from '../../world/voxel';
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
import { advanceGameplayClock, assertGameplayAdvance } from './gameplay-clock';
import { clonePosition } from './gameplay-geometry';
import type { CombatSnapshot } from './combat-runtime';
import { createGameplayCombatCallbacks } from './gameplay-combat-callbacks';

type Position = [number, number, number];
export class GameplayRuntime {
  readonly content: GameplayContent;
  readonly inventoryState: ReturnType<typeof createInventoryStatePort>;
  readonly entities: EntityStore;
  readonly simulation: AutonomyRuntime;
  private readonly players = new Map<string, PlayerState>();
  private time = 0;
  private revision = 0;
  private persistedRevision = 0;
  private inventoryOperationCount = 0;
  private eventCount = 0;
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

  constructor(private readonly callbacks: GameplayCallbacks) {
    const resolved = resolveGameplayComposition(callbacks);
    this.content = resolved.content;
    this.needsPlayerLimit = callbacks.composition?.registrations.states.some(
      ({ definition }) => definition.id === NEEDS_COMPONENT || definition.id === BLOCK_WORLD_COMPONENT,
    )
      ? 128
      : undefined;
    this.ruleset = createWorldRulesetState(callbacks.composition);
    this.compositionGuard = resolved.guard;
    this.entities = new EntityStore(this.content.items);
    this.inventoryState = createInventoryStatePort({
      entities: this.entities,
      items: this.content.items,
      revision: () => this.revision,
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
      revision: () => this.revision,
      assertCanChange: () => this.assertRevisionCapacity(),
      changed: (inventory = false) => {
        if (inventory) this.inventoryOperationCount++;
        this.touch();
      },
    };
    const registered = createGameplayRegisteredAdapters({
      ...registeredPorts,
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
      findSafeLanding: (id) => findGameplayModeLanding(this.entities.get(id)!, callbacks.getVoxel, this.revision),
      assertCanChange: () => this.assertRevisionCapacity(),
      prepareCancelIncompatibleActions: (id, reason) => this.simulation.prepareInterruption(id, reason),
      changed: () => this.touch(),
    });
    this.modules = new GameplayModuleRuntime({
      combat: this.registeredCombat?.state,
      blocks: this.registeredBlocks?.state,
      feeding: this.registeredFeeding?.state,
      composition: callbacks.composition,
      entities: this.entities,
      clone: callbacks.platform.clone,
      inventory: this.inventoryState,
      inventoryActions: this.registeredInventory?.state,
      ruleset: this.ruleset.port,
      needs: createNeedsStatePort({
        entities: this.entities,
        actorIds: () => [...this.players.keys(), ...this.simulation.actorIds()],
        revision: () => this.revision,
        assertCanChange: () => this.assertRevisionCapacity(),
        changed: () => this.touch(),
        prepareDeaths: (ids) => this.simulation.prepareDeaths(ids),
      }),
      mode: createModeStatePort(this.entities, this.modes, () => this.revision),
    });
    this.schedule = callbacks.composition
      ? createGameplayModuleSchedule(callbacks.composition, this.modules, callbacks.moduleSystemAuthority, () => {
          this.registeredCombat?.drain();
        })
      : null;
    this.simulation = new AutonomyRuntime({
      entities: this.entities,
      registeredNeeds: !!callbacks.composition,
      registeredCombat: !!callbacks.composition,
      combatOrigin: this.registeredCombat?.environment.originOptions,
      registeredCombatRequest: (actorId, targetId, existingActionId) =>
        this.registeredCombat!.request(actorId, targetId, existingActionId),
      getVoxel: (x, y, z) => callbacks.getVoxel([x, y, z]) ?? Voxel.Stone,
      getWorldTime: callbacks.getWorldTime,
      isPlayerAlive: (id) => this.players.get(id)?.lifecycle === 'alive',
      clone: callbacks.platform.clone,
      meleeDefinitions: this.content.meleeDefinitions,
      combat: createGameplayCombatCallbacks({
        entities: this.entities,
        players: this.players,
        simulation: () => this.simulation,
        vitals: this.vitals,
        getVoxel: callbacks.getVoxel,
        assertCanChange: () => this.assertRevisionCapacity(),
        changed: () => this.touch(),
      }),
    });
  }

  get hasComposition() {
    return !!this.callbacks.composition;
  }
  get resources() {
    return this.callbacks.composition?.resources ?? [];
  }
  getActorModeState(id: string) {
    const entity = this.entities.get(id);
    return entity && entity.type !== 'world-item' ? this.modes.stateFor(id) : null;
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
  dispose(): void {
    try {
      this.schedule?.dispose();
    } finally {
      this.modules.dispose();
    }
  }

  get gameplayTime(): number {
    return this.schedule?.time ?? this.time;
  }

  get gameplayRevision(): number {
    return this.revision;
  }

  get persistedGameplayRevision(): number {
    return this.persistedRevision;
  }

  spawn(input: EntitySpawn): GameplayEntity {
    if (input.type === 'player' && this.players.size >= (this.needsPlayerLimit ?? Infinity))
      throw new RangeError('Needs player membership budget exceeded.');
    const entity = this.entities.spawn(input);
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
    const entity = this.entities.spawn(input);
    this.simulation.registerActor(entity.id, registration);
    this.touch();
    return entity;
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

  despawnEntity(id: string): boolean {
    this.simulation.cancelCombat(id, 'entity-removed');
    this.simulation.cancelCombatTarget(id);
    this.simulation.unregisterActor(id);
    const removed = this.entities.despawn(id);
    if (!removed) return false;
    this.players.delete(id);
    this.touch();
    return true;
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
  craft(id: string, recipeId: string) {
    return (this.registeredInventory ?? this.inventoryActions).craft(id, recipeId);
  }
  listCraftable(id: string) {
    return this.inventoryActions.listCraftable(id);
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
    if (!this.registeredFeeding) throw new Error('Registered Feeding is unavailable.');
    return (actorId: string, targetId: string, existingActionId?: string) =>
      this.registeredFeeding!.request(actorId, targetId, existingActionId, binding);
  }
  bindActorCombat(binding: WorldModuleBinding) {
    if (!this.registeredCombat) throw new Error('Registered Combat is unavailable.');
    return (actorId: string, targetId: string, existingActionId?: string) =>
      this.registeredCombat!.request(actorId, targetId, existingActionId, binding);
  }

  attackEntity(
    playerId: string,
    targetId: string,
  ): GameplayResult<{ actionId: string; buffered: boolean; damage?: number }> {
    const player = this.player(playerId);
    const active = this.requireAlive(player);
    if (active) return active;
    if (this.registeredCombat) return this.registeredCombat.request(playerId, targetId);
    const selected = player.inventory.slot(player.selectedSlot);
    const melee = selected ? this.content.items.capability(selected.itemId, 'melee') : undefined;
    const result = this.simulation.requestCombat(playerId, targetId, melee?.definitionId ?? 'unarmed');
    if (!result.success) return result;
    this.touch();
    const resolved = this.simulation.combatSnapshotFor(playerId).lastResult;
    return {
      ...result,
      ...(resolved?.actionId === result.actionId && resolved.outcome === 'hit' ? { damage: resolved.damage } : {}),
    };
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
    assertGameplayAdvance(seconds);
    this.schedule?.assertAdvance(seconds);
    if (seconds > 0) this.assertRevisionCapacity();
    this.schedule?.activate();
    this.modules.flushQueued();
    this.registeredBlocks?.drain();
    const startingRevision = this.revision;
    const commits: WorldCommitResult[] = [];
    advanceGameplayClock(seconds, (step) => {
      const canonical = this.schedule?.assertAdvance(step) ?? step;
      if (this.schedule) this.players.forEach((player) => this.advancePlayer(player, canonical, commits));
      const elapsed = this.schedule ? this.schedule.advance(canonical) : canonical;
      if (!this.schedule) {
        this.time += elapsed;
        this.players.forEach((player) => this.advancePlayer(player, elapsed, commits));
      }
      this.simulation.advanceAuthorityRules(elapsed);
      this.registeredBlocks?.drain();
    });
    if (seconds > 0 && this.revision === startingRevision) this.touch(false);
    for (const commit of this.registeredBlocks?.takeCommits() ?? []) commits.push(commit);
    return { commits };
  }

  createSnapshot(): GameplaySnapshot.GameplaySnapshotV4 {
    const moduleSchedule = this.schedule?.snapshot();
    this.modules.prepareSnapshot();
    this.registeredCombat?.drain();
    this.modules.prepareSnapshot();
    this.registeredCombat?.drain();
    const snapshot = GameplaySnapshot.createGameplaySnapshotV4(
      this.revision,
      this.gameplayTime,
      this.callbacks.getWorldTime(),
      this.entities.exportComponentSnapshot(),
      this.simulation.snapshot(),
    );
    if (this.compositionGuard) snapshot.composition = this.compositionGuard.snapshot();
    const ruleset = this.ruleset.snapshot();
    if (ruleset) snapshot.ruleset = ruleset;
    if (moduleSchedule) snapshot.moduleSchedule = moduleSchedule;
    return snapshot;
  }

  metrics() {
    const entities = this.entities.query();
    const spatial = this.entities.metrics();
    return {
      entityCount: entities.length,
      worldItemCount: entities.filter((entity) => entity.type === 'world-item').length,
      creatureCount: entities.filter((entity) => entity.type === 'creature').length,
      npcCount: entities.filter((entity) => entity.type === 'npc').length,
      nearbyVisitedBucketCount: spatial.visitedBucketCount,
      nearbyCandidateCount: spatial.visitedEntityCount,
      nearbyReturnedCount: spatial.returnedEntityCount,
      inventoryOperationCount: this.inventoryOperationCount,
      gameplayEventCount: this.eventCount,
      snapshotBytes: this.callbacks.platform.utf8.encode(JSON.stringify(this.createSnapshot())).byteLength,
      ...this.simulation.metrics(),
    };
  }

  restoreSnapshot(raw: unknown): { version: 1 | 2 | 3 | 4; worldTime?: number } {
    this.compositionGuard?.validateGameplay(raw);
    this.ruleset.validateGameplay(raw);
    if (!this.compositionGuard && raw && typeof raw === 'object' && 'composition' in raw)
      throw new TypeError('Gameplay composition requires a matching composed host.');
    const installSchedule = this.schedule?.prepareRestore(raw);
    if (!this.schedule && raw && typeof raw === 'object' && 'moduleSchedule' in raw)
      throw new TypeError('Gameplay module schedule requires a composed host.');
    const restored = GameplaySnapshot.restoreGameplayRuntimeSnapshot(raw, {
      getVoxel: (x, y, z) => this.callbacks.getVoxel([x, y, z]) ?? Voxel.Stone,
      getWorldTime: this.callbacks.getWorldTime,
      clone: this.callbacks.platform.clone,
      items: this.content.items,
      meleeDefinitions: this.content.meleeDefinitions,
      entities: this.entities,
      registeredNeeds: !!this.schedule,
      registeredFeeding: !!this.callbacks.composition,
      registeredBlocks: this.callbacks.composition?.registrations.states.some(
        ({ definition }) => definition.id === BLOCK_WORLD_COMPONENT,
      ),
      combatOriginFor: this.registeredCombat ? (entities) => this.registeredCombat!.originFor(entities) : undefined,
      needsPlayerLimit: this.needsPlayerLimit,
      simulation: this.simulation,
      players: this.players,
      installMetadata: (gameplayTime, revision) => {
        this.time = gameplayTime;
        this.revision = revision;
        this.persistedRevision = revision;
      },
    });
    installSchedule?.();
    this.modules.clearBindings();
    this.registeredBlocks?.takeCommits();
    return restored;
  }

  markPersisted(revision: number): void {
    this.persistedRevision = Math.max(this.persistedRevision, revision);
  }

  private advancePlayer(player: PlayerState, seconds: number, commits: WorldCommitResult[]): void {
    if (player.lifecycle !== 'alive') return;
    if (!this.registeredBlocks) this.blocks.advanceBreak(player.entityId, seconds, commits);
    if (!this.schedule) this.vitals.advanceNeeds(player.entityId, seconds);
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
    if (!Number.isSafeInteger(this.revision) || this.revision >= Number.MAX_SAFE_INTEGER)
      throw new RangeError('Gameplay revision capacity is exhausted.');
  }

  private touch(event = true): void {
    this.revision += 1;
    if (event) this.eventCount += 1;
  }
}
