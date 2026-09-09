import type { PreparedWorldEdit } from './prepared-world-edit';
import type { WorldResourceAuthorizer } from './harness/world-authorization';
import type { RegisteredActorOperationBinding, RegisteredOperationRequest } from './composition/operation-contracts';
import type { WorldCommitResult, WorldEditBatch } from './game-server';
import type {
  ActorArchetype,
  EntityQuery,
  EntitySpawn,
  EntityUpdate,
  GameplayEntity,
  EntityLifetimeReference,
} from './gameplay/entity-store';
import { GameplayRuntime } from './gameplay/gameplay-runtime';
import { legacyPlayerPositionToFeet } from './gameplay/gameplay-snapshot';
import type { ItemStack } from './gameplay/item-registry';
import type { ActorActionInput } from './simulation/action-runtime';
import type { ActorRegistration } from './simulation/autonomy-runtime';
import type { ActorAuthorityAction } from './simulation/actor-authority-rules';
import { applyActorAuthorityAction as applyActorAction } from './gameplay/actor-authority-gameplay';
import type { PoiInput, PoiKind } from './simulation/poi-registry';
import type { ChunkPersistence } from './persistence/chunk-persistence';
import type { GameplayPersistence } from './persistence/gameplay-persistence';
import type { CorePlatformPorts } from '../runtime/platform-ports';
import type { GameplayContent } from './gameplay/gameplay-content';
import type { GameServerOptions } from './game-server-types';
import type { ItemDefinitionRegistry } from './gameplay/item-registry';

type Persistence = ChunkPersistence & Partial<GameplayPersistence>;

export abstract class GameServerGameplayFacade {
  protected readonly gameplay: GameplayRuntime;
  private readonly legacyEntityIds = new Set<string>();
  private restoredVersion: 1 | 2 | 3 | 4 | null = null;

  protected constructor(
    private readonly gameplayPersistence: Persistence | undefined,
    platform: CorePlatformPorts,
    content?: GameplayContent,
    compositionOptions: Pick<
      GameServerOptions,
      'composition' | 'allowLegacyCompositionMigration' | 'moduleSystemAuthority' | 'moduleActorAuthority'
    > = {},
  ) {
    this.gameplay = new GameplayRuntime({
      getVoxel: (position) => this.readGameplayVoxel(...position),
      prepareVoxelEdit: (actorId, position, voxel) => this.prepareVoxelEdit(actorId, position, voxel),
      getWorldTime: () => this.worldTime,
      platform,
      content,
      composition: compositionOptions.composition,
      moduleSystemAuthority: compositionOptions.moduleSystemAuthority,
      moduleActorAuthority: compositionOptions.moduleActorAuthority,
      allowLegacyCompositionMigration: compositionOptions.allowLegacyCompositionMigration,
    });
  }

  abstract get worldTime(): number;
  abstract getVoxel(x: number, y: number, z: number): number;
  abstract editBatch(batch: WorldEditBatch): WorldCommitResult;
  abstract prepareVoxelEdit(
    actorId: string,
    position: readonly [number, number, number],
    voxel: number,
  ): PreparedWorldEdit;
  abstract setWorldTime(hours: number): number;

  protected readGameplayVoxel(x: number, y: number, z: number): number | undefined {
    return this.getVoxel(x, y, z);
  }

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
  spawnAutonomousActor(input: {
    id?: string;
    archetype: ActorArchetype;
    position: [number, number, number];
    registration?: Omit<ActorRegistration, 'archetype'>;
  }): GameplayEntity {
    const type = input.archetype === 'settler' ? 'npc' : 'creature';
    const maxHealth = input.archetype === 'night-stalker' ? 16 : input.archetype === 'settler' ? 20 : 12;
    return this.gameplay.spawnAutonomous(
      {
        id: input.id,
        type,
        archetype: input.archetype,
        position: input.position,
        health: maxHealth,
        maxHealth,
        persistent: true,
      },
      { archetype: input.archetype, ...input.registration },
    );
  }
  getEntity(id: string): GameplayEntity | null {
    const entity = this.gameplay.getEntity(id);
    return entity && this.legacyEntityIds.has(id) ? this.legacyEntity(entity) : entity;
  }
  createEntityReference(id: string): EntityLifetimeReference | null {
    return this.gameplay.entities.createReference(id);
  }
  resolveEntityReference(reference: EntityLifetimeReference): GameplayEntity | null {
    return this.gameplay.entities.resolveReference(reference);
  }
  updateEntity(id: string, update: EntityUpdate): GameplayEntity {
    const entity = this.gameplay.updateEntity(id, update);
    return this.legacyEntityIds.has(id) ? this.legacyEntity(entity) : entity;
  }
  updateEntityWithoutSnapshot(id: string, update: EntityUpdate): void {
    this.gameplay.updateEntityWithoutSnapshot(id, update);
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
  getActorModeState(id: string) {
    return this.gameplay.getActorModeState(id);
  }
  bindModuleOperations(authorizer: WorldResourceAuthorizer, source: RegisteredActorOperationBinding) {
    return this.gameplay.bindModuleOperations(authorizer, source);
  }
  invokeModuleOperation(
    authorizer: WorldResourceAuthorizer,
    source: Omit<RegisteredActorOperationBinding, 'moduleId'>,
    request: RegisteredOperationRequest,
  ) {
    return this.gameplay.invokeModuleOperation(authorizer, source, request);
  }
  get hasGameplayComposition() {
    return this.gameplay.hasComposition;
  }
  get gameplayResources() {
    return this.gameplay.resources;
  }
  disposeGameplay() {
    this.gameplay.dispose();
  }
  getPlayerState(id: string) {
    return this.gameplay.getPlayerState(id);
  }
  getInventory(id: string) {
    return this.gameplay.getInventory(id);
  }
  get itemDefinitions(): ItemDefinitionRegistry {
    return this.gameplay.content.items;
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
  getCombatState(entityId: string) {
    return this.gameplay.getCombatState(entityId);
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
  advanceGameplayRules(seconds: number) {
    return this.gameplay.advanceRules(seconds);
  }
  applyActorAuthorityAction(actorId: string, action: ActorAuthorityAction) {
    return applyActorAction(
      {
        entities: this.gameplay.entities,
        simulation: this.gameplay.simulation,
        getVoxel: (position) => this.readGameplayVoxel(...position),
        isPlayerAlive: (id) => this.gameplay.getPlayerState(id).lifecycle === 'alive',
        items: this.gameplay.content.items,
        touch: () => this.gameplay.recordAuthorityMutation(),
      },
      actorId,
      action,
    );
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
  getActorState(id: string) {
    return this.gameplay.simulation.getActor(id);
  }
  startActorAction(actorId: string, input: Omit<ActorActionInput, 'actorId'>) {
    return this.gameplay.simulation.startAction(actorId, input);
  }
  interruptActorAction(actorId: string, reason?: string) {
    return this.gameplay.simulation.interruptAction(actorId, reason);
  }
  getActorAction(actorId: string) {
    return this.gameplay.simulation.actions.forActor(actorId);
  }
  getAction(actionId: string) {
    return this.gameplay.simulation.actions.get(actionId);
  }
  observeActor(actorId: string, range?: number) {
    return this.gameplay.simulation.observe(actorId, range);
  }
  registerPoi(input: PoiInput) {
    return this.gameplay.simulation.registerPoi(input);
  }
  removePoi(id: string) {
    return this.gameplay.simulation.pois.remove(id);
  }
  getPoi(id: string) {
    return this.gameplay.simulation.pois.get(id);
  }
  queryPois(position: [number, number, number], radius: number, kind?: PoiKind) {
    return this.gameplay.simulation.pois.queryNearby(position, radius, kind);
  }
  queryNavigationPath(actorId: string, target: [number, number, number]) {
    const actor = this.getEntity(actorId);
    if (!actor) throw new RangeError(`Unknown actor: ${actorId}`);
    return this.gameplay.simulation.navigator.plan(actor.position, target);
  }
  simulationSnapshot() {
    return this.gameplay.simulation.snapshot();
  }
  simulationMetrics() {
    return this.gameplay.simulation.metrics();
  }
  get restoredGameplayVersion() {
    return this.restoredVersion;
  }

  async restore(): Promise<void> {
    const snapshot = await this.gameplayPersistence?.loadGameplaySnapshot?.();
    if (snapshot) {
      const restored = this.gameplay.restoreSnapshot(snapshot);
      this.restoredVersion = restored.version;
      if (restored.worldTime !== undefined) this.setWorldTime(restored.worldTime);
      return;
    }
    const legacyPosition = await this.gameplayPersistence?.loadLegacyPlayerPosition?.();
    if (legacyPosition)
      this.gameplay.spawnPlayer({ id: 'player-1', position: legacyPlayerPositionToFeet(legacyPosition) });
  }

  protected createGameplaySnapshot() {
    return this.gameplay.createSnapshot();
  }

  protected fluidPriorityForActor(actorId: string) {
    return actorId === 'player-edit' || this.gameplay.getEntity(actorId)?.type === 'player'
      ? 'interactive'
      : 'ordinary';
  }

  protected fluidPriorityForBatch(batch: WorldEditBatch) {
    return batch.edits?.length === 1 && !batch.buffers?.length ? this.fluidPriorityForActor(batch.actorId) : 'ordinary';
  }

  protected markGameplayPersisted(revision: number): void {
    this.gameplay.markPersisted(revision);
  }

  private legacyEntity(entity: GameplayEntity): GameplayEntity {
    return { id: entity.id, kind: entity.kind, position: [...entity.position] } as GameplayEntity;
  }
}
