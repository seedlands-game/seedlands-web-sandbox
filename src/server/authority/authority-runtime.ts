import { bodyConfigFor, bodyKindForEntity } from '../../physics/body-registry';
import { TransactionDeduplicator, type InputCommand, type SequenceDecision } from '../../runtime/session-protocol';
import type {
  AuthorityAction,
  AuthorityActionResult,
  AuthorityGameplayView,
  AuthorityMeshPayload,
  AuthorityReady,
} from '../../worker/authority-worker-protocol';
import { GameServer } from '../game-server';
import type { WorkerCanonicalResult, WorldCommitResult } from '../game-server-types';
import type { ChunkPersistence } from '../persistence/chunk-persistence';
import type { GameplayPersistence } from '../persistence/gameplay-persistence';
import type { FluidAuthoritySnapshot, FluidCandidate } from '../fluid/fluid-transaction';
import type { VoxelEdit } from '../world-mutation';
import { ServerCommandExecutor } from '../commands/server-command-executor';
import type { CommandSource, ServerCommand } from '../commands/command-contract';
import { AuthoritySession, type AuthoritySnapshot, type LogicIntent } from './authority-session';
import { buildLogicObservation } from './logic-observation-builder';
import { LOGIC_PROTOCOL_VERSION, type LogicIntentBatch, type LogicObservation } from '../logic/logic-protocol';
import { CHUNK_SIZE } from '../../world/voxel';

export type AuthorityFrequencies = Readonly<{
  physicsHz: 30 | 60 | 120;
  gameplayHz: 10 | 20;
  fluidHz: 20 | 30;
}>;

export type AuthorityAdvanceResult = Readonly<{
  snapshot: AuthoritySnapshot;
  lanes: Readonly<{ physicsSteps: number; gameplayPeriods: number; fluidPeriods: number }>;
  gameplay: AuthorityGameplayView;
  commits: readonly WorldCommitResult[];
}>;

type AuthorityPersistence = ChunkPersistence &
  Partial<GameplayPersistence> & { metrics?: () => Readonly<{ recordBytes: number }> };

export type AuthorityRuntimeOptions = Readonly<{
  epoch: string;
  seedText: string;
  persistence?: AuthorityPersistence;
  generatorVersion?: number;
  initialWorldTime: number;
  startTimeMs: number;
  initialPlayerBodyPosition?: [number, number, number];
  findInitialPlayerBodyPosition?: (seed: number, generatorVersion: number) => Promise<[number, number, number]>;
  now?: () => number;
  frequencies?: AuthorityFrequencies;
  onFluidWork?: (snapshot: FluidAuthoritySnapshot) => void;
  onLogicObservation?: (observation: LogicObservation) => void;
  onUnknownChunk?: (key: string) => void;
}>;

export type AuthorityTransactionIdentity = Readonly<{
  epoch: string;
  issuer: string;
  stream: string;
  sequence: number;
  expectedCommitSequence?: number;
}>;

export type AuthorityTransactionReceipt<T> = Readonly<
  | { status: 'executed'; commitSequence: number; result: T }
  | { status: 'conflict' | 'expired' | 'capacity'; commitSequence: number }
>;

export class AuthorityRuntime {
  readonly server: GameServer;
  readonly playerId: string;
  readonly frequencies: AuthorityFrequencies;
  private readonly session: AuthoritySession;
  private readonly newPlayer: boolean;
  private readonly initialBodyPosition: [number, number, number];
  private pendingCommits: WorldCommitResult[] = [];
  private logicObservationSequence = 0;
  private identityRevisionSequence = 0;
  private latestPhysicsTick = 0;
  private readonly entityIdentities = new Map<string, { signature: string; revision: number }>();
  private readonly logicObservations = new Map<number, LogicObservation>();
  private logicObservationRequested = false;
  private currentTimeMs: number;
  private readonly transactions: TransactionDeduplicator<Promise<AuthorityTransactionReceipt<unknown>>>;

  private constructor(
    private readonly options: AuthorityRuntimeOptions,
    server: GameServer,
    playerId: string,
    isNew: boolean,
  ) {
    this.server = server;
    this.frequencies = options.frequencies ?? { physicsHz: 60, gameplayHz: 20, fluidHz: 30 };
    this.currentTimeMs = options.startTimeMs;
    this.transactions = new TransactionDeduplicator(options.epoch);
    this.playerId = playerId;
    this.newPlayer = isNew;
    const player = server.getEntity(playerId);
    if (!player) throw new Error(`Authority player is missing: ${playerId}`);
    this.initialBodyPosition = [...player.position];
    const serverPort = {
      get worldRevision() {
        return server.worldRevision;
      },
      get mutationCount() {
        return server.mutationCount;
      },
      get worldTime() {
        return server.worldTime;
      },
      getEntity: (id: string) => server.getEntity(id),
      queryEntities: () => server.queryEntities(),
      updateEntity: (id: string, update: Parameters<GameServer['updateEntity']>[1]) => server.updateEntity(id, update),
      advanceGameplayRules: (seconds: number) => {
        const result = server.advanceGameplayRules(seconds);
        this.pendingCommits.push(...result.commits);
        return result;
      },
      advanceWorldClock: (hours: number) => server.advanceClock(hours),
      queryPickupTargets: () =>
        server
          .queryEntities({ type: 'player' })
          .filter((entity) => server.getPlayerState(entity.id).lifecycle === 'alive')
          .map((entity) => ({ id: entity.id, position: [...entity.position] as [number, number, number] })),
      pickupItem: (playerId: string, itemId: string) => server.pickupItem(playerId, itemId),
    };
    this.session = new AuthoritySession({
      epoch: options.epoch,
      playerId,
      server: serverPort,
      bodyConfigFor: (entity) => bodyConfigFor(bodyKindForEntity(entity)),
      voxelSource: { getLoadedVoxel: (x, y, z) => server.peekLoadedVoxel(x, y, z) },
      frequencies: this.frequencies,
      startTimeMs: options.startTimeMs,
      requestUnknownChunk: (key) => this.requestUnknownChunk(key),
      requestFluidWork: () => this.requestFluidWork(),
      publishLogicObservation: (snapshot) => {
        if (!this.logicObservationRequested) return;
        this.logicObservationRequested = false;
        const observation = this.buildLogicObservation(++this.logicObservationSequence, snapshot);
        this.logicObservations.set(observation.observationSequence, observation);
        while (this.logicObservations.size > 8)
          this.logicObservations.delete(this.logicObservations.keys().next().value!);
        options.onLogicObservation?.(observation);
      },
    });
  }

  static async create(options: AuthorityRuntimeOptions): Promise<AuthorityRuntime> {
    const server = new GameServer({
      seedText: options.seedText,
      ...(options.generatorVersion === undefined ? {} : { generatorVersion: options.generatorVersion }),
      ...(options.persistence ? { persistence: options.persistence } : {}),
    });
    server.setWorldTime(options.initialWorldTime);
    await server.restore();
    let player = server.queryEntities({ type: 'player' })[0];
    const isNew = !player;
    if (!player) {
      const bodyPosition =
        options.initialPlayerBodyPosition ??
        (await options.findInitialPlayerBodyPosition?.(server.seed, server.generatorVersion));
      if (!bodyPosition) throw new Error('新世界必须由通用计算Worker提供安全出生点。');
      player = server.spawnPlayer({ position: bodyPosition });
    }
    return new AuthorityRuntime(
      { ...options, startTimeMs: options.now?.() ?? options.startTimeMs },
      server,
      player.id,
      isNew,
    );
  }

  ready(): AuthorityReady {
    const camp = this.server.queryPois(this.initialBodyPosition, 40, 'camp')[0];
    return {
      playerId: this.playerId,
      playerBodyPosition: [...this.initialBodyPosition],
      isNew: this.newPlayer,
      seed: this.server.seed,
      seedText: this.options.seedText,
      generatorVersion: this.server.generatorVersion,
      worldTime: this.server.worldTime,
      snapshot: this.session.wake(this.options.startTimeMs),
      gameplay: this.view(),
      ...(camp ? { campPosition: [...camp.position] as [number, number, number] } : {}),
    };
  }

  wake(nowMs: number): AuthoritySnapshot {
    const snapshot = this.session.wake(nowMs);
    this.currentTimeMs = nowMs;
    this.latestPhysicsTick = snapshot.physicsTick;
    return snapshot;
  }

  advanceSession(elapsedMs: number): AuthorityAdvanceResult {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 60_000)
      throw new RangeError('Authority session advance must be finite and within 0..60000ms.');
    const before = this.session.laneTotals;
    const intervalMs = 1_000 / Math.max(...Object.values(this.frequencies));
    const targetTimeMs = this.currentTimeMs + elapsedMs;
    let snapshot = this.wake(this.currentTimeMs);
    while (this.currentTimeMs < targetTimeMs) {
      const nextTimeMs = Math.min(targetTimeMs, this.currentTimeMs + intervalMs);
      snapshot = this.wake(nextTimeMs);
    }
    const physicsIntervalMs = 1_000 / this.frequencies.physicsHz;
    while (!snapshot.paused && snapshot.physicsDebtMs + 1e-7 >= physicsIntervalMs)
      snapshot = this.wake(this.currentTimeMs);
    const after = this.session.laneTotals;
    return {
      snapshot,
      lanes: {
        physicsSteps: after.physicsSteps - before.physicsSteps,
        gameplayPeriods: after.gameplayPeriods - before.gameplayPeriods,
        fluidPeriods: after.fluidPeriods - before.fluidPeriods,
      },
      gameplay: this.view(),
      commits: this.takeCommits(),
    };
  }

  receiveInput(command: InputCommand): SequenceDecision {
    return this.session.receiveInput(command);
  }

  get inputResyncRequired(): boolean {
    return this.session.inputResyncRequired;
  }

  receiveLogicIntents(epoch: string, intents: readonly LogicIntent[]): boolean {
    return this.session.receiveLogicIntents(epoch, intents);
  }

  receiveLogicIntentBatch(batch: LogicIntentBatch): boolean {
    if (batch.protocolVersion !== LOGIC_PROTOCOL_VERSION || batch.epoch !== this.options.epoch) return false;
    const observation = this.logicObservations.get(batch.observationSequence);
    if (!observation || batch.expiresAtPhysicsTick < this.latestPhysicsTick) return false;
    const observedById = new Map(observation.entities.map((entity) => [entity.id, entity] as const));
    const currentById = new Map(this.server.queryEntities().map((entity) => [entity.id, entity] as const));
    const maximumPoseStaleness = Math.ceil(this.frequencies.physicsHz * 0.2);
    const accepted: LogicIntent[] = [];
    for (const intent of batch.intents) {
      const observed = observedById.get(intent.entityId);
      const current = currentById.get(intent.entityId);
      if (
        !observed ||
        !current ||
        observed.identityRevision !== intent.identityRevision ||
        observed.poseRevision !== intent.observedPoseRevision ||
        this.identityRevision(current) !== intent.identityRevision ||
        this.latestPhysicsTick - intent.observedPoseRevision > maximumPoseStaleness ||
        !this.currentChunkRevisions(intent.readChunkRevisions)
      )
        continue;
      this.applyLogicAction(intent.entityId, intent.action);
      accepted.push({
        entityId: intent.entityId,
        wish: { x: intent.wish.x, z: intent.wish.z },
        jumpRequested: intent.jumpRequested,
        verticalIntent: intent.verticalIntent,
        expiresAtPhysicsTick: batch.expiresAtPhysicsTick,
      });
    }
    return this.session.receiveLogicIntents(batch.epoch, accepted);
  }

  requestLogicObservation(): void {
    this.logicObservationRequested = true;
  }

  async executeTransaction<T>(
    identity: AuthorityTransactionIdentity,
    operation: () => T | Promise<T>,
  ): Promise<AuthorityTransactionReceipt<T>> {
    const outcome = this.transactions.execute(
      identity.epoch,
      identity.issuer,
      identity.stream,
      identity.sequence,
      async () => {
        if (
          identity.expectedCommitSequence !== undefined &&
          identity.expectedCommitSequence !== this.session.currentCommitSequence
        )
          return {
            status: 'conflict' as const,
            commitSequence: this.session.currentCommitSequence,
          };
        const result = await operation();
        return {
          status: 'executed' as const,
          commitSequence: this.session.currentCommitSequence,
          result,
        };
      },
    );
    if (!('receipt' in outcome)) return { status: outcome.status, commitSequence: this.session.currentCommitSequence };
    return outcome.receipt as Promise<AuthorityTransactionReceipt<T>>;
  }

  pause(nowMs: number): void {
    this.session.pause(nowMs);
    this.currentTimeMs = nowMs;
  }

  resume(nowMs: number): void {
    this.session.resume(nowMs);
    this.currentTimeMs = nowMs;
  }

  async prepareMesh(cx: number, cy: number, cz: number): Promise<AuthorityMeshPayload> {
    await this.server.ensureChunkNeighborhood(cx, cy, cz);
    const prepared = this.server.prepareWorkerMeshInput(cx, cy, cz);
    return {
      key: prepared.key,
      cx,
      cy,
      cz,
      chunkRevision: prepared.chunkRevision,
      generatorVersion: this.server.generatorVersion,
      ...(prepared.canonical ? { canonical: prepared.canonical.buffer as ArrayBuffer } : {}),
      ...(prepared.fluid ? { fluid: prepared.fluid.buffer as ArrayBuffer } : {}),
      overlays: prepared.overlays.map((overlay) => ({
        cx: overlay.cx,
        cy: overlay.cy,
        cz: overlay.cz,
        voxels: overlay.voxels.buffer as ArrayBuffer,
        ...(overlay.fluid ? { fluid: overlay.fluid.buffer as ArrayBuffer } : {}),
      })),
    };
  }

  acceptGeneratedChunk(result: WorkerCanonicalResult): boolean {
    return this.server.acceptWorkerCanonical(result);
  }

  releaseMesh(cx: number, cy: number, cz: number): void {
    this.server.releaseChunkNeighborhood(cx, cy, cz);
  }

  setFluidActiveChunks(keys: readonly string[]): void {
    this.server.setFluidActiveChunks(keys);
  }

  editWorld(actorId: string, edits: readonly VoxelEdit[]) {
    const result = this.server.editBatch({ actorId, edits });
    if (result.committed) {
      this.pendingCommits.push(result);
      this.session.commitExternalState(false);
    }
    return result;
  }

  setPlayerPosition(position: [number, number, number]): void {
    this.server.updateEntity(this.playerId, { position, physicsVelocity: [0, 0, 0] });
    this.session.synchronizeExternalState();
  }

  performAction(action: AuthorityAction): AuthorityActionResult {
    const before = this.serverStateVersion();
    let result: unknown;
    switch (action.type) {
      case 'select-hotbar':
        result = this.server.selectHotbarSlot(this.playerId, action.slot);
        break;
      case 'craft':
        result = this.server.craft(this.playerId, action.recipeId);
        break;
      case 'attack':
        result = this.server.attackEntity(this.playerId, action.targetId);
        break;
      case 'begin-break':
        result = this.server.beginBreak(this.playerId, action.position);
        break;
      case 'cancel-break':
        result = this.server.cancelBreak(this.playerId);
        break;
      case 'place': {
        result = this.server.placeVoxel(this.playerId, action.position);
        const commit = (result as { success?: boolean; commit?: WorldCommitResult }).commit;
        if (commit) this.pendingCommits.push(commit);
        break;
      }
      case 'respawn':
        result = this.server.respawnPlayer(this.playerId);
        break;
      case 'move-inventory':
        result = this.server.moveInventorySlot(this.playerId, action.source, action.target);
        break;
      case 'use-inventory':
        result = this.server.useInventoryItem(this.playerId, action.slot);
        break;
    }
    this.commitIfServerChanged(before);
    return { result, gameplay: this.view(), commits: this.takeCommits() };
  }

  commitFluidCandidate(candidate: FluidCandidate) {
    const result = this.server.commitFluidCandidate(candidate);
    if (result.accepted && result.commit?.committed) {
      this.pendingCommits.push(result.commit);
      this.session.commitExternalState(false);
    }
    return result;
  }

  async executeCommand(source: CommandSource, command: ServerCommand) {
    const before = this.serverStateVersion();
    const result = await new ServerCommandExecutor(this.server, { save: () => this.save() }).execute(source, command);
    this.commitIfServerChanged(before);
    return result;
  }

  setWorldTime(hours: number): number {
    const before = this.server.worldTime;
    const value = this.server.setWorldTime(hours);
    if (value !== before) this.session.commitExternalState(false);
    return value;
  }

  advanceWorldClock(hours: number): number {
    if (!hours) return this.server.worldTime;
    const value = this.server.advanceClock(hours);
    this.session.commitExternalState(false);
    return value;
  }

  abortFluidWork(workId: string, reason: string): boolean {
    return this.server.abortFluidWork(workId, reason);
  }

  async save() {
    const frozen = this.server.freezeSaveSnapshot(this.session.currentCommitSequence);
    const result = await this.server.saveFrozen(frozen);
    return { ...result, storageBytes: this.options.persistence?.metrics?.().recordBytes ?? 0 };
  }

  view(): AuthorityGameplayView {
    return {
      gameplayRevision: this.server.gameplayRevision,
      gameplayTime: this.server.gameplayTime,
      player: this.server.getPlayerState(this.playerId),
      entities: this.server.queryEntities(),
      actors: this.server.simulationSnapshot().actors,
      craftableRecipeIds: this.server.listCraftableRecipes(this.playerId).map((recipe) => recipe.id),
      metrics: this.server.gameplayMetrics(),
    };
  }

  takeCommits(): WorldCommitResult[] {
    return this.pendingCommits.splice(0);
  }

  private requestFluidWork(): void {
    const snapshot = this.server.requestFluidWork();
    if (snapshot) this.options.onFluidWork?.(snapshot);
  }

  private requestUnknownChunk(key: string): void {
    this.options.onUnknownChunk?.(key);
  }

  private buildLogicObservation(sequence: number, snapshot: AuthoritySnapshot): LogicObservation {
    const entities = this.server.queryEntities();
    return buildLogicObservation({
      epoch: this.options.epoch,
      observationSequence: sequence,
      snapshot,
      entities,
      simulation: this.server.simulationSnapshot(),
      identityRevision: (entity) => this.identityRevision(entity),
      getLoadedVoxel: (x, y, z) => this.server.peekLoadedVoxel(x, y, z),
    });
  }

  private identityRevision(entity: ReturnType<GameServer['queryEntities']>[number]): number {
    const signature = `${entity.type}:${entity.archetype ?? ''}:${entity.stack?.itemId ?? ''}`;
    const current = this.entityIdentities.get(entity.id);
    if (current?.signature === signature) return current.revision;
    const revision = ++this.identityRevisionSequence;
    this.entityIdentities.set(entity.id, { signature, revision });
    return revision;
  }

  private currentChunkRevisions(reads: readonly Readonly<{ key: string; revision: number }>[]): boolean {
    return reads.every(({ key, revision }) => {
      const parts = key.split(',').map(Number);
      if (parts.length !== 3 || parts.some((value) => !Number.isInteger(value))) return false;
      return (
        this.server.peekLoadedVoxel(parts[0] * CHUNK_SIZE, parts[1] * CHUNK_SIZE, parts[2] * CHUNK_SIZE)?.revision ===
        revision
      );
    });
  }

  private applyLogicAction(entityId: string, action: LogicIntentBatch['intents'][number]['action']): void {
    if (!action) return;
    if (action.type === 'start-existing-action') return;
    if (action.type === 'move-to') {
      this.server.startActorAction(entityId, { type: 'move-to', targetPosition: action.target });
      return;
    }
    if (action.type === 'attack') {
      this.server.startActorAction(entityId, { type: 'attack', targetEntityId: action.targetId });
      const target = this.server.getEntity(action.targetId);
      if (target?.type === 'player') this.server.applyDamage(entityId, action.targetId, 2, 'logic-worker-attack');
      return;
    }
    this.server.startActorAction(entityId, { type: 'eat', targetEntityId: action.targetId });
    this.server.despawnEntity(action.targetId);
  }

  private serverStateVersion() {
    return {
      gameplayRevision: this.server.gameplayRevision,
      worldRevision: this.server.worldRevision,
      worldTime: this.server.worldTime,
    };
  }

  private commitIfServerChanged(before: ReturnType<AuthorityRuntime['serverStateVersion']>) {
    if (
      before.gameplayRevision !== this.server.gameplayRevision ||
      before.worldRevision !== this.server.worldRevision ||
      before.worldTime !== this.server.worldTime
    )
      this.session.commitExternalState();
  }
}
