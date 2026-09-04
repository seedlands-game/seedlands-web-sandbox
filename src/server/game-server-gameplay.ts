import type { WorldCommitResult, WorldEditBatch } from './game-server';
import type { EntityQuery, EntitySpawn, EntityUpdate, GameplayEntity } from './gameplay/entity-store';
import { GameplayRuntime } from './gameplay/gameplay-runtime';
import type { ItemStack } from './gameplay/item-registry';
import type { ChunkPersistence } from './persistence/chunk-persistence';
import type { GameplayPersistence } from './persistence/gameplay-persistence';

type Persistence = ChunkPersistence & Partial<GameplayPersistence>;

export abstract class GameServerGameplayFacade {
  protected readonly gameplay: GameplayRuntime;
  private readonly legacyEntityIds = new Set<string>();

  protected constructor(private readonly gameplayPersistence?: Persistence) {
    this.gameplay = new GameplayRuntime({
      getVoxel: (position) => this.getVoxel(...position),
      editVoxel: (actorId, position, voxel) =>
        this.editBatch({
          actorId,
          edits: [{ x: position[0], y: position[1], z: position[2], value: voxel }],
        }),
    });
  }

  abstract getVoxel(x: number, y: number, z: number): number;
  abstract editBatch(batch: WorldEditBatch): WorldCommitResult;
  abstract flushDirtyChunks(): Promise<string[]>;

  createEntity(entity: EntitySpawn): GameplayEntity {
    const created = this.gameplay.spawn(entity);
    this.legacyEntityIds.add(created.id);
    return this.legacyEntity(created);
  }
  spawnEntity(entity: EntitySpawn): GameplayEntity {
    return this.gameplay.spawn(entity);
  }
  spawnPlayer(entity: { id?: string; position: [number, number, number] }): GameplayEntity {
    return this.gameplay.spawnPlayer(entity);
  }
  spawnWorldItem(position: [number, number, number], stack: ItemStack): GameplayEntity {
    return this.gameplay.spawnWorldItem(position, stack);
  }
  getEntity(id: string): GameplayEntity | null {
    const entity = this.gameplay.getEntity(id);
    return entity && this.legacyEntityIds.has(id) ? this.legacyEntity(entity) : entity;
  }
  updateEntity(id: string, update: EntityUpdate): GameplayEntity {
    const entity = this.gameplay.updateEntity(id, update);
    return this.legacyEntityIds.has(id) ? this.legacyEntity(entity) : entity;
  }
  despawnEntity(id: string): boolean {
    return this.gameplay.despawnEntity(id);
  }
  queryEntities(filter: EntityQuery = {}): GameplayEntity[] {
    return this.gameplay.queryEntities(filter);
  }
  queryNearbyEntities(position: [number, number, number], radius: number, filter: EntityQuery = {}): GameplayEntity[] {
    return this.gameplay.queryNearbyEntities(position, radius, filter);
  }
  getPlayerState(id: string) {
    return this.gameplay.getPlayerState(id);
  }
  getInventory(id: string) {
    return this.gameplay.getInventory(id);
  }
  giveItem(id: string, stack: ItemStack) {
    return this.gameplay.giveItem(id, stack);
  }
  removeItem(id: string, stack: ItemStack) {
    return this.gameplay.removeItem(id, stack);
  }
  selectHotbarSlot(id: string, slot: number) {
    return this.gameplay.selectHotbarSlot(id, slot);
  }
  moveInventorySlot(id: string, source: number, target: number) {
    return this.gameplay.moveInventorySlot(id, source, target);
  }
  useInventoryItem(id: string, slot: number) {
    return this.gameplay.useInventoryItem(id, slot);
  }
  craft(id: string, recipeId: string) {
    return this.gameplay.craft(id, recipeId);
  }
  listCraftableRecipes(id: string) {
    return this.gameplay.listCraftable(id);
  }
  listRecipes() {
    return this.gameplay.listRecipes();
  }
  beginBreak(id: string, position: [number, number, number]) {
    return this.gameplay.beginBreak(id, position);
  }
  cancelBreak(id: string) {
    return this.gameplay.cancelBreak(id);
  }
  pickupItem(playerId: string, entityId: string) {
    return this.gameplay.pickupItem(playerId, entityId);
  }
  dropItem(playerId: string, slot: number, count: number) {
    return this.gameplay.dropItem(playerId, slot, count);
  }
  placeVoxel(id: string, position: [number, number, number]) {
    return this.gameplay.placeVoxel(id, position);
  }
  useSelectedItem(id: string) {
    return this.gameplay.useSelectedItem(id);
  }
  attackEntity(playerId: string, targetId: string) {
    return this.gameplay.attackEntity(playerId, targetId);
  }
  applyDamage(actorId: string, playerId: string, amount: number, cause: string) {
    return this.gameplay.applyDamage(actorId, playerId, amount, cause);
  }
  healPlayer(playerId: string, amount: number) {
    return this.gameplay.healPlayer(playerId, amount);
  }
  setHungerForDebug(playerId: string, hunger: number) {
    return this.gameplay.setHungerForDebug(playerId, hunger);
  }
  respawnPlayer(playerId: string) {
    return this.gameplay.respawnPlayer(playerId);
  }
  advanceGameplay(seconds: number) {
    return this.gameplay.advance(seconds);
  }
  get gameplayTime(): number {
    return this.gameplay.gameplayTime;
  }
  get gameplayRevision(): number {
    return this.gameplay.gameplayRevision;
  }
  get persistedGameplayRevision(): number {
    return this.gameplay.persistedGameplayRevision;
  }
  gameplayMetrics() {
    return this.gameplay.metrics();
  }

  async save(): Promise<{ savedChunks: string[]; gameplaySaved: boolean }> {
    const snapshot = this.gameplay.createSnapshot();
    if (this.gameplayPersistence?.saveGameplaySnapshot) {
      await this.gameplayPersistence.saveGameplaySnapshot(snapshot);
      this.gameplay.markPersisted(snapshot.revision);
    }
    const savedChunks = await this.flushDirtyChunks();
    return { savedChunks, gameplaySaved: Boolean(this.gameplayPersistence?.saveGameplaySnapshot) };
  }

  async restore(): Promise<void> {
    const snapshot = await this.gameplayPersistence?.loadGameplaySnapshot?.();
    if (snapshot) return this.gameplay.restoreSnapshot(snapshot);
    const legacyPosition = await this.gameplayPersistence?.loadLegacyPlayerPosition?.();
    if (legacyPosition) this.gameplay.spawnPlayer({ id: 'player-1', position: legacyPosition });
  }

  private legacyEntity(entity: GameplayEntity): GameplayEntity {
    return { id: entity.id, kind: entity.kind, position: [...entity.position] } as GameplayEntity;
  }
}
