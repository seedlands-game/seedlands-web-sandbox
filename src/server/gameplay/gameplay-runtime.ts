import { playerOccupiesVoxelShape } from './player-occupancy';
import { EntityPhysics, voxelRayIsClear } from './entity-physics';
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
import { getItemDefinition, type ItemStack } from './item-registry';
import { PlayerState, type PlayerSnapshot } from './player-state';
import { craftRecipe, listCraftableRecipes, listRecipes } from './recipe-registry';
import { getVoxelGameplayDefinition } from './voxel-gameplay';
import { simulationSnapshotFor, validateGameplaySnapshot, type GameplaySnapshotV2 } from './gameplay-snapshot';

export type { GameplaySnapshot, GameplaySnapshotV1, GameplaySnapshotV2 } from './gameplay-snapshot';

type Position = [number, number, number];
type PickupEvent = { playerId: string; position: Position; stack: ItemStack };
type GameplayCallbacks = {
  getVoxel: (position: Position) => number;
  editVoxel: (actorId: string, position: Position, voxel: number) => WorldCommitResult;
  getWorldTime: () => number;
};
type Failure = { success: false; reason: string };
type Success<Data extends object = Record<never, never>> = { success: true } & Data;
export type GameplayResult<Data extends object = Record<never, never>> = Success<Data> | Failure;

const distanceSquared = (left: readonly number[], right: readonly number[]) =>
  left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0);
const clonePosition = (position: readonly [number, number, number]): Position => [...position];
const attackTargetPoint = (target: GameplayEntity): Position => {
  const height = target.archetype === 'grazer' ? 1.9 : target.archetype === 'settler' ? 2.35 : 2.1;
  return [target.position[0], target.position[1] + height / 2, target.position[2]];
};

export class GameplayRuntime {
  readonly entities = new EntityStore();
  readonly simulation: AutonomyRuntime;
  readonly physics: EntityPhysics;
  private readonly players = new Map<string, PlayerState>();
  private time = 0;
  private revision = 0;
  private persistedRevision = 0;
  private inventoryOperationCount = 0;
  private eventCount = 0;
  private readonly pickupEvents: PickupEvent[] = [];

  constructor(private readonly callbacks: GameplayCallbacks) {
    this.simulation = new AutonomyRuntime({
      entities: this.entities,
      getVoxel: (x, y, z) => callbacks.getVoxel([x, y, z]),
      getWorldTime: callbacks.getWorldTime,
      isPlayerAlive: (id) => this.players.get(id)?.lifecycle === 'alive',
      damagePlayer: (actorId, targetId, amount) => this.damagePlayerFromActor(actorId, targetId, amount),
      consumeWorldItem: (entityId) => {
        const entity = this.entities.get(entityId);
        if (!entity || entity.type !== 'world-item') return false;
        const removed = this.entities.despawn(entityId);
        if (removed) this.touch();
        return removed;
      },
      spawnWorldItem: (position, stack) => void this.spawnWorldItem(position, stack),
    });
    this.physics = new EntityPhysics({
      entities: this.entities,
      getVoxel: (x, y, z) => callbacks.getVoxel([x, y, z]),
      pickupTargets: () =>
        [...this.players.entries()]
          .filter(([, player]) => player.lifecycle === 'alive')
          .map(([id]) => ({ id, position: clonePosition(this.entities.get(id)!.position) })),
    });
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
      this.players.set(entity.id, new PlayerState(entity.id, clonePosition(entity.position)));
    if (entity.archetype) this.simulation.registerActor(entity.id, { archetype: entity.archetype });
    this.touch();
    return entity;
  }

  spawnPlayer(input: { id?: string; position: Position }): GameplayEntity {
    return this.spawn({ ...input, type: 'player' });
  }

  spawnWorldItem(position: Position, stack: ItemStack): GameplayEntity {
    const entity = this.spawn({ type: 'world-item', position, stack });
    return entity;
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

  despawnEntity(id: string): boolean {
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
    return this.player(id).snapshot();
  }

  getInventory(id: string) {
    const player = this.player(id);
    return { slots: player.inventory.snapshot(), selectedSlot: player.selectedSlot };
  }

  giveItem(id: string, stack: ItemStack): GameplayResult<{ inventory: ReturnType<GameplayRuntime['getInventory']> }> {
    const player = this.player(id);
    if (!player.inventory.add(stack)) return { success: false, reason: 'inventory-full' };
    this.inventoryOperationCount += 1;
    this.touch();
    return { success: true, inventory: this.getInventory(id) };
  }

  removeItem(id: string, stack: ItemStack): GameplayResult {
    if (!this.player(id).inventory.remove(stack)) return { success: false, reason: 'missing-items' };
    this.inventoryOperationCount += 1;
    this.touch();
    return { success: true };
  }

  selectHotbarSlot(id: string, slot: number): GameplayResult {
    if (!this.player(id).selectSlot(slot)) return { success: false, reason: 'invalid-slot' };
    this.touch();
    return { success: true };
  }

  moveInventorySlot(id: string, source: number, target: number): GameplayResult {
    const player = this.player(id);
    const active = this.requireAlive(player);
    if (active) return active;
    if (!player.inventory.moveStack(source, target)) return { success: false, reason: 'cannot-move-item' };
    this.inventoryOperationCount++;
    this.touch();
    return { success: true };
  }

  craft(id: string, recipeId: string): ReturnType<typeof craftRecipe> | { success: false; reason: 'player-dead' } {
    const player = this.player(id);
    if (player.lifecycle !== 'alive') return { success: false, reason: 'player-dead' };
    const result = craftRecipe(player.inventory, recipeId);
    if (result.success) {
      this.inventoryOperationCount += 1;
      this.touch();
    }
    return result;
  }

  listCraftable(id: string) {
    return listCraftableRecipes(this.player(id).inventory);
  }

  listRecipes() {
    return listRecipes();
  }

  beginBreak(id: string, position: Position): GameplayResult<{ requiredSeconds: number }> {
    const player = this.player(id);
    const active = this.requireAlive(player);
    if (active) return active;
    const entity = this.entities.get(id)!;
    if (!this.inRange(entity.position, this.voxelCenter(position), 5))
      return { success: false, reason: 'out-of-range' };
    const voxel = this.callbacks.getVoxel(position);
    const definition = getVoxelGameplayDefinition(voxel);
    if (definition.hardnessSeconds === null) return { success: false, reason: 'unbreakable' };
    const selected = player.inventory.slot(player.selectedSlot);
    const tool = selected ? getItemDefinition(selected.itemId).toolKind : undefined;
    const multiplier = tool === definition.preferredTool ? (tool === 'axe' ? 3 : 4) : 1;
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
    const player = this.player(playerId);
    const active = this.requireAlive(player);
    if (active) return active;
    const item = this.entities.get(entityId);
    if (!item || item.type !== 'world-item' || !item.stack) return { success: false, reason: 'invalid-item' };
    const entity = this.entities.get(playerId)!;
    if (!this.inRange(entity.position, item.position, 1.5)) return { success: false, reason: 'out-of-range' };
    if (!voxelRayIsClear(item.position, entity.position, (x, y, z) => this.callbacks.getVoxel([x, y, z])))
      return { success: false, reason: 'blocked' };
    if (!player.inventory.add(item.stack)) return { success: false, reason: 'inventory-full' };
    this.inventoryOperationCount += 1;
    this.entities.despawn(entityId);
    if (this.pickupEvents.length >= 128) this.pickupEvents.shift();
    this.pickupEvents.push({ playerId, position: clonePosition(item.position), stack: { ...item.stack } });
    this.touch();
    return { success: true };
  }

  dropItem(playerId: string, slot: number, count: number): GameplayResult<{ entity: GameplayEntity }> {
    const player = this.player(playerId);
    const active = this.requireAlive(player);
    if (active) return active;
    if (!Number.isInteger(slot) || slot < 0 || slot >= player.inventory.capacity)
      return { success: false, reason: 'invalid-slot' };
    if (!Number.isInteger(count) || count <= 0) return { success: false, reason: 'invalid-count' };
    const stack = player.inventory.slot(slot);
    if (!stack || stack.count < count) return { success: false, reason: 'missing-items' };
    player.inventory.removeFromSlot(slot, count);
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
    if (!this.inRange(entity.position, this.voxelCenter(position), 5))
      return { success: false, reason: 'out-of-range' };
    if (!getVoxelGameplayDefinition(this.callbacks.getVoxel(position)).replaceable)
      return { success: false, reason: 'target-occupied' };
    const selected = player.inventory.slot(player.selectedSlot);
    if (!selected) return { success: false, reason: 'no-selected-item' };
    const definition = getItemDefinition(selected.itemId);
    if (definition.placesVoxel === undefined) return { success: false, reason: 'item-not-placeable' };
    if (playerOccupiesVoxelShape(entity.position, position, definition.placesVoxel))
      return { success: false, reason: 'player-collision' };
    const commit = this.callbacks.editVoxel(id, position, definition.placesVoxel);
    if (!commit.committed) return { success: false, reason: 'world-not-changed' };
    player.inventory.removeFromSlot(player.selectedSlot, 1);
    this.inventoryOperationCount += 1;
    this.touch();
    return { success: true, commit };
  }

  useSelectedItem(id: string): GameplayResult {
    return this.useInventoryItem(id, this.player(id).selectedSlot);
  }

  useInventoryItem(id: string, slot: number): GameplayResult {
    const player = this.player(id);
    const active = this.requireAlive(player);
    if (active) return active;
    if (!Number.isInteger(slot) || slot < 0 || slot >= player.inventory.capacity)
      return { success: false, reason: 'invalid-slot' };
    const selected = player.inventory.slot(slot);
    if (!selected) return { success: false, reason: 'no-selected-item' };
    const item = getItemDefinition(selected.itemId);
    if (!item.hungerRestore) return { success: false, reason: 'item-not-usable' };
    if (player.hunger >= player.maxHunger) return { success: false, reason: 'hunger-full' };
    player.inventory.removeFromSlot(slot, 1);
    this.inventoryOperationCount += 1;
    player.hunger = Math.min(player.maxHunger, player.hunger + item.hungerRestore);
    this.touch();
    return { success: true };
  }

  attackEntity(playerId: string, targetId: string): GameplayResult<{ damage: number }> {
    const player = this.player(playerId);
    const active = this.requireAlive(player);
    if (active) return active;
    if (player.attackCooldownSeconds > 0) return { success: false, reason: 'cooldown' };
    const attacker = this.entities.get(playerId)!;
    const target = this.entities.get(targetId);
    if (!target || (target.type !== 'creature' && target.type !== 'npc') || target.health === undefined)
      return { success: false, reason: 'invalid-target' };
    if (!this.inRange(attacker.position, target.position, 3)) return { success: false, reason: 'out-of-range' };
    if (!voxelRayIsClear(attacker.position, attackTargetPoint(target), (x, y, z) => this.callbacks.getVoxel([x, y, z])))
      return { success: false, reason: 'blocked' };
    const damage = 4;
    const health = Math.max(0, target.health - damage);
    this.entities.update(targetId, { health });
    this.simulation.recordAttacked(targetId, playerId);
    if (health === 0) {
      const drop = this.simulation.unregisterActor(targetId, 'killed');
      this.entities.despawn(targetId);
      if (drop) this.spawnWorldItem(clonePosition(target.position), drop);
    }
    player.attackCooldownSeconds = 0.5;
    this.touch();
    return { success: true, damage };
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

  advance(seconds: number): { commits: WorldCommitResult[]; pickups: PickupEvent[] } {
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new TypeError('Gameplay seconds must be non-negative and finite.');
    const commits: WorldCommitResult[] = [];
    let remaining = seconds;
    while (remaining > 0) {
      const step = Math.min(1, remaining);
      this.time += step;
      this.players.forEach((player) => this.advancePlayer(player, step, commits));
      this.simulation.advance(step);
      this.physics.advance(step, () => this.autoPickup());
      remaining -= step;
    }
    if (seconds > 0) this.touch(false);
    return { commits, pickups: this.pickupEvents.splice(0) };
  }

  createSnapshot(): GameplaySnapshotV2 {
    return {
      version: 2,
      revision: this.revision,
      gameplayTime: this.time,
      worldTime: this.callbacks.getWorldTime(),
      entitySequence: this.entities.nextSequence,
      entities: this.entities.exportSnapshot(),
      players: [...this.players.values()].map((player) => player.snapshot()),
      simulation: this.simulation.snapshot(),
    };
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
      snapshotBytes: new TextEncoder().encode(JSON.stringify(this.createSnapshot())).byteLength,
      ...this.simulation.metrics(),
    };
  }

  restoreSnapshot(raw: unknown): { version: 1 | 2; worldTime?: number } {
    try {
      const { snapshot, players } = validateGameplaySnapshot(raw, {
        getVoxel: (x, y, z) => this.callbacks.getVoxel([x, y, z]),
        getWorldTime: this.callbacks.getWorldTime,
      });
      this.entities.restore(snapshot.entities, snapshot.entitySequence);
      this.pickupEvents.length = 0;
      this.players.clear();
      players.forEach((player, id) => this.players.set(id, player));
      this.time = snapshot.gameplayTime;
      this.revision = snapshot.revision;
      this.persistedRevision = snapshot.revision;
      this.simulation.restore(simulationSnapshotFor(snapshot));
      return snapshot.version === 2 ? { version: 2, worldTime: snapshot.worldTime } : { version: 1 };
    } catch (error) {
      throw new Error(`Invalid gameplay snapshot: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
  }

  markPersisted(revision: number): void {
    this.persistedRevision = Math.max(this.persistedRevision, revision);
  }

  private advancePlayer(player: PlayerState, seconds: number, commits: WorldCommitResult[]): void {
    player.attackCooldownSeconds = Math.max(0, player.attackCooldownSeconds - seconds);
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
    if (
      this.callbacks.getVoxel(action.position) !== action.voxel ||
      !this.inRange(entity.position, this.voxelCenter(action.position), 5)
    ) {
      player.breakAction = null;
      return;
    }
    action.elapsedSeconds += seconds;
    if (action.elapsedSeconds + Number.EPSILON < action.requiredSeconds) return;
    player.breakAction = null;
    const definition = getVoxelGameplayDefinition(action.voxel);
    const commit = this.callbacks.editVoxel(player.entityId, action.position, Voxel.Air);
    if (!commit.committed) return;
    commits.push(commit);
    if (definition.drop) this.spawnWorldItem(this.voxelCenter(action.position), { ...definition.drop });
  }

  private autoPickup(): void {
    let pickedUp = false;
    [...this.players.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([id, player]) => {
        if (player.lifecycle !== 'alive') return;
        const position = this.entities.get(id)?.position;
        if (!position) return;
        for (const item of this.entities.queryNearby(position, 0.75, { type: 'world-item' })) {
          if (!this.pickupItem(id, item.id).success) continue;
          pickedUp = true;
        }
      });
    if (pickedUp) this.touch();
  }

  private killPlayer(player: PlayerState): void {
    player.lifecycle = 'dead';
    player.breakAction = null;
    player.attackCooldownSeconds = 0;
    const position = this.entities.get(player.entityId)!.position;
    player.inventory.clear().forEach((stack) => this.spawnWorldItem(clonePosition(position), stack));
  }

  private damagePlayerFromActor(actorId: string, playerId: string, amount: number): boolean {
    const player = this.players.get(playerId);
    if (!player || player.lifecycle !== 'alive') return false;
    player.health = Math.max(0, player.health - amount);
    if (player.health === 0) this.killPlayer(player);
    this.touch();
    void actorId;
    return true;
  }

  private player(id: string): PlayerState {
    const player = this.players.get(id);
    if (!player) throw new RangeError(`Unknown player: ${id}`);
    return player;
  }

  private requireAlive(player: PlayerState): Failure | null {
    return player.lifecycle === 'alive' ? null : { success: false, reason: 'player-dead' };
  }

  private inRange(left: readonly number[], right: readonly number[], radius: number): boolean {
    return distanceSquared(left, right) <= radius * radius;
  }

  private voxelCenter(position: Position): Position {
    return [position[0] + 0.5, position[1] + 0.5, position[2] + 0.5];
  }

  private touch(event = true): void {
    this.revision += 1;
    if (event) this.eventCount += 1;
  }
}
