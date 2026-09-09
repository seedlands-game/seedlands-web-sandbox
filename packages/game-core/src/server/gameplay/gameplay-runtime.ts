import { ActorVitalsRuntime } from './modules/actor-vitals-runtime';
import { ModeRuntime } from './modules/mode-runtime';
import { createModeStatePort } from './modules/mode-state-port';
import { GameplayModuleRuntime } from './modules/gameplay-module-runtime';
import { findSafeModeLanding } from '../authority/creative-physics';
import type { WorldResourceAuthorizer } from '../harness/world-authorization';
import type { RegisteredOperationBinding, RegisteredOperationRequest } from '../composition/operation-contracts';
import { ActorInventoryRuntime } from './modules/actor-inventory-runtime';
import { createInventoryStatePort } from './modules/inventory-state-port';
import { resolveGameplayComposition } from '../composition/gameplay-composition';
import type { WorldComposition } from '../composition/contracts';
import { advancePlayerNeeds } from './modules/needs-runtime';
import { BlockInteractionRuntime } from './modules/block-interaction-runtime';
import { traceVoxelRay } from './voxel-ray';
import { Voxel, CHUNK_SIZE, chunkKey } from '../../world/voxel';
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
import type { ActorComponentAccess } from './ecs-actor-components';
import { type GameplayContent } from './gameplay-content';
import * as GameplaySnapshot from './gameplay-snapshot';
import { advanceGameplayClock, assertGameplayAdvance } from './gameplay-clock';
import { clonePosition, positionsInRange } from './gameplay-geometry';
import type { CorePlatformPorts } from '../../runtime/platform-ports';
import type { CombatSnapshot, MeleeDefinition } from './combat-runtime';
import { applyCombatDamage, isCombatantAvailable, validateCombatHit } from './gameplay-combat';

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
  editVoxel: (actorId: string, position: Position, voxel: number) => WorldCommitResult;
  getWorldTime: () => number;
  platform: CorePlatformPorts;
  content?: GameplayContent;
  composition?: WorldComposition;
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
  private readonly modules;
  private readonly blocks;

  constructor(private readonly callbacks: GameplayCallbacks) {
    const resolved = resolveGameplayComposition(callbacks);
    this.content = resolved.content;
    this.compositionGuard = resolved.guard;
    this.entities = new EntityStore(this.content.items);
    this.inventoryState = createInventoryStatePort({
      entities: this.entities,
      items: this.content.items,
      revision: () => this.revision,
      changed: () => this.touch(),
    });
    this.inventoryActions = new ActorInventoryRuntime({
      actor: (id) => this.inventoryActor(id),
      recipes: this.content.recipes,
      cancelCombat: (id, reason) => this.simulation.cancelCombat(id, reason),
      changed: (operation) => {
        if (operation) this.inventoryOperationCount++;
        this.touch();
      },
    });
    this.vitals = new ActorVitalsRuntime({
      player: (id) => this.player(id),
      killPlayer: (player) => this.killPlayer(player),
      touch: () => this.touch(),
      entities: this.entities,
    });
    this.modes = new ModeRuntime({
      entities: this.entities,
      findSafeLanding: (id) =>
        findSafeModeLanding(this.entities.get(id)!, {
          getLoadedVoxel: (x, y, z) => {
            const voxel = callbacks.getVoxel([x, y, z]);
            return voxel === undefined
              ? null
              : {
                  voxel,
                  chunkKey: chunkKey(
                    Math.floor(x / CHUNK_SIZE),
                    Math.floor(y / CHUNK_SIZE),
                    Math.floor(z / CHUNK_SIZE),
                  ),
                  revision: this.revision,
                };
          },
        }),
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
      editVoxel: callbacks.editVoxel,
      items: this.content.items,
      changed: (inventoryOperation) => {
        if (inventoryOperation) this.inventoryOperationCount++;
        this.touch();
      },
      spawnDrop: (position, stack) => void this.spawnWorldItem(position, stack),
    });
    this.modules = new GameplayModuleRuntime({
      composition: callbacks.composition,
      entities: this.entities,
      clone: callbacks.platform.clone,
      inventory: this.inventoryState,
      mode: createModeStatePort(this.entities, this.modes, () => this.revision),
    });
    this.simulation = new AutonomyRuntime({
      entities: this.entities,
      getVoxel: (x, y, z) => callbacks.getVoxel([x, y, z]) ?? Voxel.Stone,
      getWorldTime: callbacks.getWorldTime,
      isPlayerAlive: (id) => this.players.get(id)?.lifecycle === 'alive',
      clone: callbacks.platform.clone,
      meleeDefinitions: this.content.meleeDefinitions,
      combat: {
        actorAvailable: (id) =>
          isCombatantAvailable(this.entities, (playerId) => this.players.get(playerId)?.lifecycle === 'alive', id),
        targetAvailable: (id) =>
          isCombatantAvailable(this.entities, (playerId) => this.players.get(playerId)?.lifecycle === 'alive', id),
        validateHit: (actorId, targetId, definition) =>
          validateCombatHit(
            {
              entities: this.entities,
              getVoxel: callbacks.getVoxel,
              isPlayerAlive: (id) => this.players.get(id)?.lifecycle === 'alive',
            },
            actorId,
            targetId,
            definition,
          ),
        applyDamage: (actorId, targetId, damage) => this.applyCombatDamage(actorId, targetId, damage),
      },
    });
  }

  get resources() {
    return this.callbacks.composition?.resources ?? [];
  }
  getActorModeState(id: string) {
    const entity = this.entities.get(id);
    return entity && entity.type !== 'world-item' ? this.modes.stateFor(id) : null;
  }
  bindModuleOperations(authorizer: WorldResourceAuthorizer, source: RegisteredOperationBinding) {
    return this.modules.bind(authorizer, source);
  }
  invokeModuleOperation(
    authorizer: WorldResourceAuthorizer,
    source: Omit<RegisteredOperationBinding, 'moduleId'>,
    request: RegisteredOperationRequest,
  ) {
    return this.modules.invoke(authorizer, source, request);
  }
  dispose(): void {
    this.modules.dispose();
  }

  get gameplayTime(): number {
    return this.time;
  }

  get gameplayRevision(): number {
    return this.revision;
  }

  get persistedGameplayRevision(): number {
    return this.persistedRevision;
  }

  spawn(input: EntitySpawn): GameplayEntity {
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
    const player = this.inventoryActor(playerId);
    const active = this.requireAlive(player);
    if (active) return active;
    const item = this.entities.get(entityId);
    if (!item || item.type !== 'world-item' || !item.stack) return { success: false, reason: 'invalid-item' };
    const entity = this.entities.get(playerId)!;
    if (!positionsInRange(entity.position, item.position, 1.5)) return { success: false, reason: 'out-of-range' };
    const visibility = traceVoxelRay(item.position, entity.position, (x, y, z) => this.callbacks.getVoxel([x, y, z]));
    if (visibility !== 'clear')
      return { success: false, reason: visibility === 'unavailable' ? 'chunk-unavailable' : 'blocked' };
    if (!player.inventory.add(item.stack)) return { success: false, reason: 'inventory-full' };
    this.inventoryOperationCount += 1;
    this.entities.despawn(entityId);
    this.touch();
    return { success: true };
  }

  dropItem(playerId: string, slot: number, count: number): GameplayResult<{ entity: GameplayEntity }> {
    const player = this.inventoryActor(playerId);
    const active = this.requireAlive(player);
    if (active) return active;
    if (!Number.isInteger(slot) || slot < 0 || slot >= player.inventory.capacity)
      return { success: false, reason: 'invalid-slot' };
    if (!Number.isInteger(count) || count <= 0) return { success: false, reason: 'invalid-count' };
    const stack = player.inventory.slot(slot);
    if (!stack || stack.count < count) return { success: false, reason: 'missing-items' };
    player.inventory.removeFromSlot(slot, count);
    if (slot === player.selectedSlot) this.simulation.cancelCombat(playerId, 'slot-changed');
    this.inventoryOperationCount += 1;
    const entity = this.spawnWorldItem(clonePosition(this.entities.get(playerId)!.position), {
      ...stack,
      count,
    });
    this.touch();
    return { success: true, entity };
  }

  placeVoxel(id: string, position: Position): GameplayResult<{ commit: WorldCommitResult }> {
    return this.blocks.placeVoxel(id, position);
  }

  useSelectedItem(id: string): GameplayResult {
    return this.useInventoryItem(id, this.inventoryActor(id).selectedSlot);
  }

  useInventoryItem(id: string, slot: number): GameplayResult {
    const player = this.inventoryActor(id);
    const active = this.requireAlive(player);
    if (active) return active;
    if (!Number.isInteger(slot) || slot < 0 || slot >= player.inventory.capacity)
      return { success: false, reason: 'invalid-slot' };
    const selected = player.inventory.slot(slot);
    if (!selected) return { success: false, reason: 'no-selected-item' };
    const consume = this.content.items.capability(selected.itemId, 'consume');
    if (!consume) return { success: false, reason: 'item-not-usable' };
    if (player.hungerMeaning === 'satiety' ? player.hunger >= player.maxHunger : player.hunger <= 0)
      return { success: false, reason: 'hunger-full' };
    player.inventory.removeFromSlot(slot, 1);
    this.inventoryOperationCount += 1;
    player.hunger =
      player.hungerMeaning === 'satiety'
        ? Math.min(player.maxHunger, player.hunger + consume.hungerRestore)
        : Math.max(0, player.hunger - consume.hungerRestore);
    this.touch();
    return { success: true };
  }

  attackEntity(
    playerId: string,
    targetId: string,
  ): GameplayResult<{ actionId: string; buffered: boolean; damage?: number }> {
    const player = this.player(playerId);
    const active = this.requireAlive(player);
    if (active) return active;
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
    this.modules.flushQueued();
    const commits: WorldCommitResult[] = [];
    advanceGameplayClock(seconds, (step) => {
      this.time += step;
      this.players.forEach((player) => this.advancePlayer(player, step, commits));
      this.simulation.advanceAuthorityRules(step);
    });
    if (seconds > 0) this.touch(false);
    return { commits };
  }

  createSnapshot(): GameplaySnapshot.GameplaySnapshotV4 {
    const snapshot = GameplaySnapshot.createGameplaySnapshotV4(
      this.revision,
      this.time,
      this.callbacks.getWorldTime(),
      this.entities.exportComponentSnapshot(),
      this.simulation.snapshot(),
    );
    if (this.compositionGuard) snapshot.composition = this.compositionGuard.snapshot();
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
    if (!this.compositionGuard && raw && typeof raw === 'object' && 'composition' in raw)
      throw new TypeError('Gameplay composition requires a matching composed host.');
    const restored = GameplaySnapshot.restoreGameplayRuntimeSnapshot(raw, {
      getVoxel: (x, y, z) => this.callbacks.getVoxel([x, y, z]) ?? Voxel.Stone,
      getWorldTime: this.callbacks.getWorldTime,
      clone: this.callbacks.platform.clone,
      items: this.content.items,
      meleeDefinitions: this.content.meleeDefinitions,
      entities: this.entities,
      simulation: this.simulation,
      players: this.players,
      installMetadata: (gameplayTime, revision) => {
        this.time = gameplayTime;
        this.revision = revision;
        this.persistedRevision = revision;
      },
    });
    this.modules.clearBindings();
    return restored;
  }

  markPersisted(revision: number): void {
    this.persistedRevision = Math.max(this.persistedRevision, revision);
  }

  private advancePlayer(player: PlayerState, seconds: number, commits: WorldCommitResult[]): void {
    if (player.lifecycle !== 'alive') return;
    this.blocks.advanceBreak(player.entityId, seconds, commits);
    if (player.mode === 'survival') advancePlayerNeeds(player, seconds, () => this.killPlayer(player));
  }

  private killPlayer(player: PlayerState): void {
    player.lifecycle = 'dead';
    player.breakAction = null;
    this.simulation.cancelCombat(player.entityId, 'attacker-dead');
    const position = this.entities.get(player.entityId)!.position;
    player.inventory.clear().forEach((stack) => this.spawnWorldItem(clonePosition(position), stack));
  }

  private inventoryActor(id: string): ActorComponentAccess {
    return this.entities.actorStateAccess(id);
  }

  private player(id: string): PlayerState {
    const player = this.players.get(id);
    if (!player) throw new RangeError(`Unknown player: ${id}`);
    return player;
  }

  private applyCombatDamage(actorId: string, targetId: string, amount: number): number | null {
    if (this.getActorModeState(targetId)?.mode === 'creative') return 0;
    return applyCombatDamage(
      {
        entities: this.entities,
        playerState: (id) => this.players.get(id),
        killPlayer: (player) => this.killPlayer(player),
        recordAttacked: (target, actor) => this.simulation.recordAttacked(target, actor),
        cancelTarget: (target, actor) => this.simulation.cancelCombatTarget(target, 'target-missing', actor),
        unregisterActor: (target) => this.simulation.unregisterActor(target, 'killed'),
        spawnDrop: (position, stack) => void this.spawnWorldItem(position, stack),
        touch: () => this.touch(),
      },
      actorId,
      targetId,
      amount,
    );
  }

  private requireAlive(player: Pick<PlayerState, 'lifecycle'>): Failure | null {
    return player.lifecycle === 'alive' ? null : { success: false, reason: 'player-dead' };
  }

  private touch(event = true): void {
    this.revision += 1;
    if (event) this.eventCount += 1;
  }
}
