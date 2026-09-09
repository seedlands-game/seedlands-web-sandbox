import { playerOccupiesVoxelShape } from './player-occupancy';
import { traceVoxelRay } from './voxel-ray';
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
import { getItemCapability, listItemDefinitions, type ItemStack } from './item-registry';
import { PlayerState, type PlayerSnapshot } from './player-state';
import type { ActorComponentAccess } from './ecs-actor-components';
import { craftRecipe, listCraftableRecipes, listRecipes } from './recipe-registry';
import { getVoxelGameplayDefinition } from './voxel-gameplay';
import * as GameplaySnapshot from './gameplay-snapshot';
import { advanceGameplayClock } from './gameplay-clock';
import { clonePosition, positionsInRange, voxelCenter } from './gameplay-geometry';
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
type GameplayCallbacks = {
  getVoxel: (position: Position) => number | undefined;
  editVoxel: (actorId: string, position: Position, voxel: number) => WorldCommitResult;
  getWorldTime: () => number;
  platform: CorePlatformPorts;
  meleeDefinitions?: readonly MeleeDefinition[];
};
type Failure = { success: false; reason: string };
type Success<Data extends object = Record<never, never>> = { success: true } & Data;
export type GameplayResult<Data extends object = Record<never, never>> = Success<Data> | Failure;

export class GameplayRuntime {
  readonly entities = new EntityStore();
  readonly simulation: AutonomyRuntime;
  private readonly players = new Map<string, PlayerState>();
  private time = 0;
  private revision = 0;
  private persistedRevision = 0;
  private inventoryOperationCount = 0;
  private eventCount = 0;

  constructor(private readonly callbacks: GameplayCallbacks) {
    this.simulation = new AutonomyRuntime({
      entities: this.entities,
      getVoxel: (x, y, z) => callbacks.getVoxel([x, y, z]) ?? Voxel.Stone,
      getWorldTime: callbacks.getWorldTime,
      isPlayerAlive: (id) => this.players.get(id)?.lifecycle === 'alive',
      clone: callbacks.platform.clone,
      meleeDefinitions: callbacks.meleeDefinitions,
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
    for (const item of listItemDefinitions()) {
      const melee = getItemCapability(item.id, 'melee');
      if (melee && !this.simulation.combat.hasDefinition(melee.definitionId))
        throw new TypeError(`Item ${item.id} references unknown melee definition: ${melee.definitionId}`);
    }
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
    const player = this.inventoryActor(id);
    return { slots: player.inventory.snapshot(), selectedSlot: player.selectedSlot };
  }

  giveItem(id: string, stack: ItemStack): GameplayResult<{ inventory: ReturnType<GameplayRuntime['getInventory']> }> {
    const player = this.inventoryActor(id);
    if (!player.inventory.add(stack)) return { success: false, reason: 'inventory-full' };
    this.inventoryOperationCount += 1;
    this.touch();
    return { success: true, inventory: this.getInventory(id) };
  }

  removeItem(id: string, stack: ItemStack): GameplayResult {
    if (!this.inventoryActor(id).inventory.remove(stack)) return { success: false, reason: 'missing-items' };
    this.inventoryOperationCount += 1;
    this.touch();
    return { success: true };
  }

  selectHotbarSlot(id: string, slot: number): GameplayResult {
    const player = this.inventoryActor(id);
    const previous = player.selectedSlot;
    if (!player.selectSlot(slot)) return { success: false, reason: 'invalid-slot' };
    if (slot !== previous) this.simulation.cancelCombat(id, 'slot-changed');
    this.touch();
    return { success: true };
  }

  moveInventorySlot(id: string, source: number, target: number): GameplayResult {
    const player = this.inventoryActor(id);
    const active = this.requireAlive(player);
    if (active) return active;
    if (!player.inventory.moveStack(source, target)) return { success: false, reason: 'cannot-move-item' };
    if (source === player.selectedSlot || target === player.selectedSlot)
      this.simulation.cancelCombat(id, 'slot-changed');
    this.inventoryOperationCount++;
    this.touch();
    return { success: true };
  }

  craft(id: string, recipeId: string): ReturnType<typeof craftRecipe> | { success: false; reason: 'player-dead' } {
    const player = this.inventoryActor(id);
    if (player.lifecycle !== 'alive') return { success: false, reason: 'player-dead' };
    const result = craftRecipe(player.inventory, recipeId);
    if (result.success) {
      this.inventoryOperationCount += 1;
      this.touch();
    }
    return result;
  }

  listCraftable(id: string) {
    return listCraftableRecipes(this.inventoryActor(id).inventory);
  }

  listRecipes() {
    return listRecipes();
  }

  beginBreak(id: string, position: Position): GameplayResult<{ requiredSeconds: number }> {
    const player = this.player(id);
    const active = this.requireAlive(player);
    if (active) return active;
    const entity = this.entities.get(id)!;
    if (!positionsInRange(entity.position, voxelCenter(position), 5)) return { success: false, reason: 'out-of-range' };
    const voxel = this.callbacks.getVoxel(position);
    if (voxel === undefined) return { success: false, reason: 'chunk-unavailable' };
    const definition = getVoxelGameplayDefinition(voxel);
    if (definition.hardnessSeconds === null) return { success: false, reason: 'unbreakable' };
    const selected = player.inventory.slot(player.selectedSlot);
    const mine = selected ? getItemCapability(selected.itemId, 'mine') : undefined;
    const multiplier = mine?.tool === definition.preferredTool ? mine.multiplier : 1;
    const requiredSeconds = Number((definition.hardnessSeconds / multiplier).toFixed(6));
    const current = player.breakAction;
    player.breakAction =
      current && current.voxel === voxel && current.position.every((value, index) => value === position[index])
        ? current
        : { position: clonePosition(position), voxel, elapsedSeconds: 0, requiredSeconds };
    this.touch();
    return { success: true, requiredSeconds };
  }

  cancelBreak(id: string): GameplayResult {
    const player = this.player(id);
    if (!player.breakAction) return { success: true };
    player.breakAction = null;
    this.touch();
    return { success: true };
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
      itemId: stack.itemId,
      count,
    });
    this.touch();
    return { success: true, entity };
  }

  placeVoxel(id: string, position: Position): GameplayResult<{ commit: WorldCommitResult }> {
    const player = this.player(id);
    const active = this.requireAlive(player);
    if (active) return active;
    const entity = this.entities.get(id)!;
    if (!positionsInRange(entity.position, voxelCenter(position), 5)) return { success: false, reason: 'out-of-range' };
    const currentVoxel = this.callbacks.getVoxel(position);
    if (currentVoxel === undefined) return { success: false, reason: 'chunk-unavailable' };
    if (!getVoxelGameplayDefinition(currentVoxel).replaceable) return { success: false, reason: 'target-occupied' };
    const selected = player.inventory.slot(player.selectedSlot);
    if (!selected) return { success: false, reason: 'no-selected-item' };
    const place = getItemCapability(selected.itemId, 'place');
    if (!place) return { success: false, reason: 'item-not-placeable' };
    if (playerOccupiesVoxelShape(entity.position, position, place.voxel))
      return { success: false, reason: 'player-collision' };
    const commit = this.callbacks.editVoxel(id, position, place.voxel);
    if (!commit.committed) return { success: false, reason: 'world-not-changed' };
    player.inventory.removeFromSlot(player.selectedSlot, 1);
    this.inventoryOperationCount += 1;
    this.touch();
    return { success: true, commit };
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
    const consume = getItemCapability(selected.itemId, 'consume');
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
    const melee = selected ? getItemCapability(selected.itemId, 'melee') : undefined;
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

  applyDamage(_actorId: string, playerId: string, amount: number, _cause: string): GameplayResult {
    const player = this.player(playerId);
    if (!Number.isFinite(amount) || amount <= 0) return { success: false, reason: 'invalid-damage' };
    if (player.lifecycle === 'dead') return { success: false, reason: 'player-dead' };
    player.health = Math.max(0, player.health - amount);
    if (player.health === 0) this.killPlayer(player);
    this.touch();
    return { success: true };
  }

  healPlayer(playerId: string, amount: number): GameplayResult {
    const player = this.player(playerId);
    if (player.lifecycle === 'dead') return { success: false, reason: 'player-dead' };
    if (!Number.isFinite(amount) || amount <= 0) return { success: false, reason: 'invalid-heal' };
    player.health = Math.min(player.maxHealth, player.health + amount);
    this.touch();
    return { success: true };
  }

  setHungerForDebug(playerId: string, hunger: number): void {
    if (!Number.isFinite(hunger) || hunger < 0 || hunger > 20) throw new TypeError('Hunger must be between 0 and 20.');
    this.player(playerId).hunger = hunger;
    this.touch();
  }

  respawnPlayer(playerId: string): GameplayResult {
    const player = this.player(playerId);
    if (player.lifecycle !== 'dead') return { success: false, reason: 'player-alive' };
    player.respawn();
    this.entities.move(playerId, player.spawnPosition);
    this.touch();
    return { success: true };
  }

  advanceRules(seconds: number): { commits: WorldCommitResult[] } {
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
    return GameplaySnapshot.createGameplaySnapshotV4(
      this.revision,
      this.time,
      this.callbacks.getWorldTime(),
      this.entities.exportComponentSnapshot(),
      this.simulation.snapshot(),
    );
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
    return GameplaySnapshot.restoreGameplayRuntimeSnapshot(raw, {
      getVoxel: (x, y, z) => this.callbacks.getVoxel([x, y, z]) ?? Voxel.Stone,
      getWorldTime: this.callbacks.getWorldTime,
      clone: this.callbacks.platform.clone,
      meleeDefinitions: this.callbacks.meleeDefinitions,
      entities: this.entities,
      simulation: this.simulation,
      players: this.players,
      installMetadata: (gameplayTime, revision) => {
        this.time = gameplayTime;
        this.revision = revision;
        this.persistedRevision = revision;
      },
    });
  }

  markPersisted(revision: number): void {
    this.persistedRevision = Math.max(this.persistedRevision, revision);
  }

  private advancePlayer(player: PlayerState, seconds: number, commits: WorldCommitResult[]): void {
    if (player.lifecycle !== 'alive') return;
    this.advanceBreak(player, seconds, commits);
    player.hungerAccumulator += seconds;
    while (player.hungerAccumulator >= 120) {
      player.hungerAccumulator -= 120;
      player.hunger = Math.max(0, player.hunger - 1);
    }
    if (player.hunger >= 16 && player.health < player.maxHealth) {
      player.healingAccumulator += seconds;
      while (player.healingAccumulator >= 10 && player.hunger >= 16 && player.health < player.maxHealth) {
        player.healingAccumulator -= 10;
        player.health += 1;
        player.hunger -= 1;
      }
    } else player.healingAccumulator = 0;
    if (player.hunger === 0) {
      player.starvationAccumulator += seconds;
      while (player.starvationAccumulator >= 15 && player.lifecycle === 'alive') {
        player.starvationAccumulator -= 15;
        player.health = Math.max(0, player.health - 1);
        if (player.health === 0) this.killPlayer(player);
      }
    } else player.starvationAccumulator = 0;
  }

  private advanceBreak(player: PlayerState, seconds: number, commits: WorldCommitResult[]): void {
    const action = player.breakAction;
    if (!action) return;
    const entity = this.entities.get(player.entityId)!;
    const currentVoxel = this.callbacks.getVoxel(action.position);
    if (currentVoxel === undefined) return;
    if (currentVoxel !== action.voxel || !positionsInRange(entity.position, voxelCenter(action.position), 5)) {
      player.breakAction = null;
      return;
    }
    action.elapsedSeconds += seconds;
    player.breakAction = action;
    if (action.elapsedSeconds + Number.EPSILON < action.requiredSeconds) return;
    player.breakAction = null;
    const definition = getVoxelGameplayDefinition(action.voxel);
    const commit = this.callbacks.editVoxel(player.entityId, action.position, Voxel.Air);
    if (!commit.committed) return;
    commits.push(commit);
    if (definition.drop) this.spawnWorldItem(voxelCenter(action.position), { ...definition.drop });
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
