import { RegisteredCombatRuntime } from './modules/registered-combat-runtime';
import type { ModuleActorAuthority } from '../composition/gameplay-actor-authority';
import { COMBAT_REQUEST_OPERATION } from './modules/combat-model';
import { NEEDS_COMPONENT } from './modules/needs-model';
import { createNeedsStatePort } from './modules/needs-state-port';
import { createGameplayModuleSchedule, type ModuleSystemAuthority } from './modules/gameplay-module-schedule';
import { createWorldRulesetState } from './modules/world-ruleset-state';
import { ActorVitalsRuntime } from './modules/actor-vitals-runtime';
import { ModeRuntime } from './modules/mode-runtime';
import { createModeStatePort } from './modules/mode-state-port';
import { GameplayModuleRuntime } from './modules/gameplay-module-runtime';
import { findGameplayModeLanding } from './gameplay-mode-landing';
import type { WorldResourceAuthorizer } from '../harness/world-authorization';
import type { RegisteredActorOperationBinding, RegisteredOperationRequest } from '../composition/operation-contracts';
import { ActorInventoryRuntime } from './modules/actor-inventory-runtime';
import { createInventoryStatePort } from './modules/inventory-state-port';
import { resolveGameplayComposition } from '../composition/gameplay-composition';
import type { WorldComposition } from '../composition/contracts';
import { BlockInteractionRuntime } from './modules/block-interaction-runtime';
import { Voxel } from '../../world/voxel';
import type { WorldCommitResult } from '../game-server';
import type { PreparedWorldEdit } from '../prepared-world-edit';
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
import type { CorePlatformPorts } from '../../runtime/platform-ports';
import type { CombatSnapshot, MeleeDefinition } from './combat-runtime';
import { createGameplayCombatCallbacks } from './gameplay-combat-callbacks';

export type {
  GameplaySnapshot,
  GameplaySnapshotV1,
  GameplaySnapshotV2,
  GameplaySnapshotV3,
  GameplaySnapshotV4,
} from './gameplay-snapshot';

type Position = [number, number, number];
export type GameplayCallbacks = {
  getVoxel: (position: Position) => number | undefined;
  prepareVoxelEdit: (actorId: string, position: Position, voxel: number) => PreparedWorldEdit;
  getWorldTime: () => number;
  platform: CorePlatformPorts;
  content?: GameplayContent;
  composition?: WorldComposition;
  moduleSystemAuthority?: ModuleSystemAuthority;
  moduleActorAuthority?: ModuleActorAuthority;
  allowLegacyCompositionMigration?: boolean;
  meleeDefinitions?: readonly MeleeDefinition[];
};
type Failure = { success: false; reason: string };
export type GameplayResult<Data extends object = Record<never, never>> = ({ success: true } & Data) | Failure;

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
  private readonly modes;
  private readonly vitals;
  private readonly modules: GameplayModuleRuntime;
  private readonly blocks;
  private readonly ruleset;
  private readonly schedule;
  private readonly needsPlayerLimit;
  private readonly registeredCombat: RegisteredCombatRuntime | null;

  constructor(private readonly callbacks: GameplayCallbacks) {
    const resolved = resolveGameplayComposition(callbacks);
    this.content = resolved.content;
    this.needsPlayerLimit = callbacks.composition?.registrations.states.some(
      ({ definition }) => definition.id === NEEDS_COMPONENT,
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
      changed: () => this.touch(),
    });
    this.inventoryActions = new ActorInventoryRuntime({
      actor: (id) => this.entities.actorStateAccess(id),
      recipes: this.content.recipes,
      entities: this.entities,
      getVoxel: callbacks.getVoxel,
      assertCanChange: () => this.assertRevisionCapacity(),
      assertCanCancelCombat: (id) => this.simulation.assertCanCancelCombat(id),
      cancelCombat: (id, reason) => this.simulation.cancelCombat(id, reason),
      changed: (operation) => {
        if (operation) this.inventoryOperationCount++;
        this.touch();
      },
    });
    this.vitals = new ActorVitalsRuntime({
      player: (id) => this.player(id),
      assertCanChange: () => this.assertRevisionCapacity(),
      assertCanCancelCombat: (id) => this.simulation.assertCanCancelCombat(id),
      cancelCombat: (id) => {
        this.simulation.cancelCombat(id, 'attacker-dead');
      },
      touch: (event) => this.touch(event),
      entities: this.entities,
    });
    this.modes = new ModeRuntime({
      entities: this.entities,
      findSafeLanding: (id) => findGameplayModeLanding(this.entities.get(id)!, callbacks.getVoxel, this.revision),
      cancelIncompatibleActions: (id, reason) => {
        this.simulation.interruptAction(id, reason);
        const player = this.players.get(id);
        if (player) player.breakAction = null;
      },
      changed: () => this.touch(),
    });
    this.blocks = new BlockInteractionRuntime({
      player: (id) => this.player(id),
      entity: (id) => this.entities.get(id),
      getVoxel: callbacks.getVoxel,
      prepareVoxelEdit: callbacks.prepareVoxelEdit,
      entities: this.entities,
      assertCanChange: () => this.assertRevisionCapacity(),
      items: this.content.items,
      changed: (inventoryOperation) => {
        if (inventoryOperation) this.inventoryOperationCount++;
        this.touch();
      },
    });
    this.registeredCombat = callbacks.composition
      ? new RegisteredCombatRuntime({
          composition: callbacks.composition,
          entities: this.entities,
          content: this.content,
          simulation: () => this.simulation,
          actorAuthority: callbacks.moduleActorAuthority,
          actorIds: () => [...this.players.keys(), ...this.simulation.actorIds()],
          getVoxel: callbacks.getVoxel,
          revision: () => this.revision,
          rulesetRevision: () => this.ruleset.snapshot()?.revision ?? 0,
          now: () => this.gameplayTime,
          assertCanChange: () => this.assertRevisionCapacity(),
          changed: () => this.touch(),
          modules: () => this.modules,
          systemAuthority: callbacks.moduleSystemAuthority,
        })
      : null;
    this.modules = new GameplayModuleRuntime({
      combat: this.registeredCombat?.state,
      composition: callbacks.composition,
      entities: this.entities,
      clone: callbacks.platform.clone,
      inventory: this.inventoryState,
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
      ? createGameplayModuleSchedule(callbacks.composition, this.modules, callbacks.moduleSystemAuthority, () =>
          this.registeredCombat?.drain(),
        )
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
  bindModuleOperations(authorizer: WorldResourceAuthorizer, source: RegisteredActorOperationBinding) {
    return this.modules.bind(authorizer, source);
  }
  invokeModuleOperation(
    authorizer: WorldResourceAuthorizer,
    source: Omit<RegisteredActorOperationBinding, 'moduleId'>,
    request: RegisteredOperationRequest,
  ) {
    const result = this.modules.invoke(authorizer, source, request);
    if (result.ok && request.operationId === COMBAT_REQUEST_OPERATION) this.registeredCombat?.drain();
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
    return this.getActorModeState(id)?.mode === 'creative'
      ? this.modes.selectCreativeSlot(id, slot)
      : this.inventoryActions.select(id, slot);
  }
  moveInventorySlot(id: string, source: number, target: number) {
    return this.inventoryActions.move(id, source, target);
  }
  craft(id: string, recipeId: string) {
    return this.inventoryActions.craft(id, recipeId);
  }
  listCraftable(id: string) {
    return this.inventoryActions.listCraftable(id);
  }

  listRecipes() {
    return this.content.recipes.list();
  }

  beginBreak(id: string, position: Position): GameplayResult<{ requiredSeconds: number; commit?: WorldCommitResult }> {
    return this.blocks.beginBreak(id, position);
  }

  cancelBreak(id: string): GameplayResult {
    return this.blocks.cancelBreak(id);
  }

  pickupItem(playerId: string, entityId: string): GameplayResult {
    return this.inventoryActions.pickup(playerId, entityId);
  }

  dropItem(playerId: string, slot: number, count: number): GameplayResult<{ entity: GameplayEntity }> {
    return this.inventoryActions.drop(playerId, slot, count);
  }

  placeVoxel(id: string, position: Position): GameplayResult<{ commit: WorldCommitResult }> {
    return this.blocks.placeVoxel(id, position);
  }

  useSelectedItem(id: string): GameplayResult {
    return this.useInventoryItem(id, this.entities.actorStateAccess(id).selectedSlot);
  }

  useInventoryItem(id: string, slot: number): GameplayResult {
    return this.inventoryActions.consume(id, slot);
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
    this.modules.flushQueued();
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
    });
    if (seconds > 0 && this.revision === startingRevision) this.touch(false);
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
    return restored;
  }

  markPersisted(revision: number): void {
    this.persistedRevision = Math.max(this.persistedRevision, revision);
  }

  private advancePlayer(player: PlayerState, seconds: number, commits: WorldCommitResult[]): void {
    if (player.lifecycle !== 'alive') return;
    this.blocks.advanceBreak(player.entityId, seconds, commits);
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
