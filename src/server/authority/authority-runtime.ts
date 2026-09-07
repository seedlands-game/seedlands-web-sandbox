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
import { CHUNK_SIZE, chunkKey } from '../../world/voxel';
import type * as R from './authority-runtime-types';
import { createAuthorityAdvanceCommandPort } from './authority-command-advance';
import type { AuthorityTransactionIdentity, AuthorityTransactionReceipt } from './authority-runtime-types';
import type { CanonicalChunkResidencyLimits } from '../chunk-residency';
import { AuthorityResidencyRuntime, type AuthorityResidencyDiagnostics } from './authority-residency-runtime';
import { advanceAuthoritySession } from './authority-session-advance';
import { withAuthorityResidencyDiagnostics } from './authority-snapshot-diagnostics';
import { AuthorityMutationPreparation, unavailableWorldCommit } from './authority-mutation-preparation';
import { applyAuthorityPlayerAction, unavailableAuthorityPlayerAction } from './authority-player-action';
import { queueBodyRecoveriesAfterCommit } from './authority-geometry-recovery';
import { AuthorityCanonicalPreparation, createAuthorityCanonicalRouter } from './authority-canonical-preparation';
import { prepareAuthorityMeshPayload } from './authority-mesh-payload';

export type * from './authority-runtime-types';

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
  findInitialWorldBootstrap?: (seed: number, generatorVersion: number) => Promise<R.AuthorityInitialWorldBootstrap>;
  now?: () => number;
  frequencies?: R.AuthorityFrequencies;
  onFluidWork?: (snapshot: FluidAuthoritySnapshot) => void;
  onLogicObservation?: (observation: LogicObservation) => void;
  onUnknownChunk?: (key: string) => void;
  canonicalResidency?: Partial<CanonicalChunkResidencyLimits>;
}>;

export type { AuthorityResidencyDiagnostics } from './authority-residency-runtime';

export type { AuthorityTransactionIdentity, AuthorityTransactionReceipt } from './authority-runtime-types';

export class AuthorityRuntime {
  readonly server: GameServer;
  readonly playerId: string;
  readonly frequencies: R.AuthorityFrequencies;
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
  private readonly residency: AuthorityResidencyRuntime;
  private readonly mutationPreparation: AuthorityMutationPreparation;
  private readonly canonicalPreparation: AuthorityCanonicalPreparation;

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
    this.residency = new AuthorityResidencyRuntime(server, () => this.session.currentCommitSequence);
    this.mutationPreparation = new AuthorityMutationPreparation(server, (key) => this.requestUnknownChunk(key));
    this.canonicalPreparation = new AuthorityCanonicalPreparation(
      server,
      (key) => options.onUnknownChunk?.(key),
      (key) => this.mutationPreparation.acceptAvailable(key),
    );
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
      get fluidDiagnostics() {
        return server.fluidDiagnostics;
      },
      getEntity: (id: string) => server.getEntity(id),
      queryEntities: () => server.queryEntities(),
      updateEntity: (id: string, update: Parameters<GameServer['updateEntity']>[1]) =>
        server.updateEntityWithoutSnapshot(id, update),
      advanceGameplayRules: (seconds: number) => {
        const result = server.advanceGameplayRules(seconds);
        result.commits.forEach((commit) => this.recordWorldCommit(commit));
        return result;
      },
      advanceWorldClock: (hours: number) => server.advanceClock(hours),
      setPhysicsActiveChunks: (keys: readonly string[]) => server.setPhysicsActiveChunks(keys),
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
      initialCommitSequence: server.restoredCommitSequence,
      measureNow: options.now,
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
    const unknownChunks = createAuthorityCanonicalRouter();
    const server = new GameServer({
      seedText: options.seedText,
      ...(options.generatorVersion === undefined ? {} : { generatorVersion: options.generatorVersion }),
      ...(options.persistence ? { persistence: options.persistence } : {}),
      ...(options.canonicalResidency ? { canonicalResidency: options.canonicalResidency } : {}),
      ...(options.onUnknownChunk ? { onUnknownChunk: unknownChunks.request } : {}),
    });
    server.setWorldTime(options.initialWorldTime);
    await server.restore();
    let player = server.queryEntities({ type: 'player' })[0];
    const isNew = !player;
    if (!player) {
      const bootstrap = options.initialPlayerBodyPosition
        ? null
        : await options.findInitialWorldBootstrap?.(server.seed, server.generatorVersion);
      const bodyPosition = options.initialPlayerBodyPosition ?? bootstrap?.playerBodyPosition;
      if (!bodyPosition) throw new Error('新世界必须由通用计算Worker提供安全出生点。');
      if (bootstrap) {
        for (const chunk of bootstrap.starterChunks)
          if (!server.acceptWorkerCanonical(chunk)) throw new Error(`Authority拒绝新世界生态Chunk：${chunk.key}。`);
        const ecology = server.initializeStarterEcologyFromLoadedWorld(bodyPosition);
        if (!ecology.initialized) throw new Error('新世界生态初始化未执行。');
      }
      player = server.spawnPlayer({ position: bodyPosition });
    }
    const runtime = new AuthorityRuntime(
      { ...options, startTimeMs: options.now?.() ?? options.startTimeMs },
      server,
      player.id,
      isNew,
    );
    unknownChunks.bind((key) => runtime.requestUnknownChunk(key));
    if (isNew) runtime.session.commitExternalState(false);
    return runtime;
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
      frequencies: this.frequencies,
      snapshot: withAuthorityResidencyDiagnostics(
        this.session.wake(this.options.startTimeMs),
        this.residency.diagnostics,
      ),
      gameplay: this.view(),
      ...(camp ? { campPosition: [...camp.position] as [number, number, number] } : {}),
    };
  }

  wake(nowMs: number): AuthoritySnapshot {
    const snapshot = this.session.wake(nowMs);
    this.currentTimeMs = nowMs;
    this.latestPhysicsTick = snapshot.physicsTick;
    this.residency.maintain(snapshot.activeTimeMs);
    return withAuthorityResidencyDiagnostics(snapshot, this.residency.diagnostics);
  }

  get residencyDiagnostics(): AuthorityResidencyDiagnostics {
    return this.residency.diagnostics;
  }

  advanceSession(elapsedMs: number): R.AuthorityAdvanceResult {
    return advanceAuthoritySession({
      elapsedMs,
      currentTimeMs: this.currentTimeMs,
      frequencies: this.frequencies,
      laneTotals: () => this.session.laneTotals,
      wake: (nowMs) => this.wake(nowMs),
      view: () => this.view(),
      takeCommits: () => this.takeCommits(),
    });
  }

  receiveInput(command: InputCommand): SequenceDecision {
    return this.session.receiveInput(command);
  }

  snapshot(): AuthoritySnapshot {
    return this.session.currentSnapshot;
  }

  clearPlayerInput(): void {
    const before = this.serverStateVersion();
    this.session.clearPlayerInput();
    this.server.cancelBreak(this.playerId);
    this.commitIfServerChanged(before);
  }

  /** 新宿主发布恢复后的实体标准化状态，使用新的检查点序号。 */
  commitHostActivation(): AuthoritySnapshot {
    this.session.commitExternalState(false);
    return this.snapshot();
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
    this.logicObservations.delete(batch.observationSequence);
    const observedById = new Map(observation.entities.map((entity) => [entity.id, entity] as const));
    const currentById = new Map(this.server.queryEntities().map((entity) => [entity.id, entity] as const));
    const maximumPoseStaleness = Math.ceil(this.frequencies.physicsHz * 0.2);
    const accepted: LogicIntent[] = [];
    let canonicalChanged = false;
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
        !this.currentChunkRevisions(intent.readChunkRevisions) ||
        !this.validLogicIntent(intent)
      )
        continue;
      const action = this.applyLogicAction(intent.entityId, intent.action);
      canonicalChanged ||= action?.changed ?? false;
      if (action && !action.accepted) continue;
      accepted.push({
        entityId: intent.entityId,
        wish: { x: intent.wish.x, z: intent.wish.z },
        jumpRequested: intent.jumpRequested,
        verticalIntent: intent.verticalIntent,
        expiresAtPhysicsTick: batch.expiresAtPhysicsTick,
      });
    }
    if (canonicalChanged) this.session.commitExternalState(false);
    return this.session.receiveLogicIntents(batch.epoch, accepted);
  }

  requestLogicObservation = () => void (this.logicObservationRequested = true);

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
    const before = this.serverStateVersion();
    this.session.pause(nowMs);
    this.currentTimeMs = nowMs;
    this.commitIfServerChanged(before);
  }

  resume(nowMs: number): void {
    this.session.resume(nowMs);
    this.currentTimeMs = nowMs;
  }

  async prepareMesh(cx: number, cy: number, cz: number): Promise<AuthorityMeshPayload> {
    return prepareAuthorityMeshPayload(this.server, this.options.now ?? (() => performance.now()), cx, cy, cz);
  }

  acceptGeneratedChunk(result: WorkerCanonicalResult): boolean {
    const accepted = this.server.acceptWorkerCanonical(result);
    const exactKey = result.key === chunkKey(result.cx, result.cy, result.cz);
    if (accepted || (exactKey && this.server.readCollisionBaseline(result.key, 0).status === 'available'))
      this.mutationPreparation.acceptAvailable(result.key);
    return accepted;
  }

  readCollisionBaseline(key: string, minimumRevision: number) {
    return this.server.readCollisionBaseline(key, minimumRevision);
  }

  releaseMesh(cx: number, cy: number, cz: number): void {
    this.server.releaseChunkNeighborhood(cx, cy, cz);
  }

  setFluidActiveChunks(keys: readonly string[]): void {
    this.server.setFluidActiveChunks(keys);
  }

  async editWorld(actorId: string, edits: readonly VoxelEdit[]) {
    if (!(await this.mutationPreparation.prepareEdits(edits)))
      return unavailableWorldCommit(this.server.worldRevision, edits.length);
    const result = this.server.editBatch({ actorId, edits });
    if (result.committed) {
      this.recordWorldCommit(result);
      this.session.commitExternalState(false);
    }
    return result;
  }

  setPlayerPosition(position: [number, number, number]): void {
    this.server.updateEntity(this.playerId, { position, physicsVelocity: [0, 0, 0] });
    this.session.synchronizeExternalState();
  }

  async performAction(action: AuthorityAction): Promise<AuthorityActionResult> {
    const submittedAction = structuredClone(action);
    if (!(await this.mutationPreparation.prepareAction(submittedAction, this.playerId)))
      return unavailableAuthorityPlayerAction(submittedAction, this.view());
    const before = this.serverStateVersion();
    const result = applyAuthorityPlayerAction(this.server, this.playerId, submittedAction, (commit) =>
      this.recordWorldCommit(commit),
    );
    this.commitIfServerChanged(before);
    return { submittedAction, result, gameplay: this.view(), commits: this.takeCommits() };
  }

  commitFluidCandidate(candidate: FluidCandidate) {
    const result = this.server.commitFluidCandidate(candidate);
    if (result.accepted && result.commit?.committed) {
      this.recordWorldCommit(result.commit);
      this.session.commitExternalState(false);
    }
    return result;
  }

  async executeCommand(source: CommandSource, command: ServerCommand) {
    const before = this.serverStateVersion();
    const result = await new ServerCommandExecutor(this.server, {
      save: () => this.save(),
      advanceSession: createAuthorityAdvanceCommandPort(
        (elapsedMs) => this.advanceSession(elapsedMs),
        (commits) => this.pendingCommits.push(...commits),
      ),
      prepareWorld: (commandSource, preparedCommand, buffer) =>
        this.mutationPreparation.prepareCommand(commandSource, preparedCommand, buffer),
    }).execute(source, command);
    if (result.success && result.commit?.committed) this.recordWorldCommit(result.commit);
    if (command.type !== 'advance-gameplay') this.commitIfServerChanged(before);
    return result;
  }

  setWorldTime(hours: number): number {
    const before = this.server.worldTime;
    const value = this.server.setWorldTime(hours);
    if (value !== before) this.session.commitExternalState(false);
    return value;
  }

  setWorldClockRate = (rate: number) => this.session.setWorldClockRate(rate);

  abortFluidWork(workId: string, reason: string): boolean {
    return this.server.abortFluidWork(workId, reason);
  }

  async save() {
    const frozen = this.server.freezeSaveSnapshot(this.session.currentCommitSequence);
    const result = await this.server.saveFrozen(frozen);
    this.residency.recordSaveSuccess();
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
    this.canonicalPreparation.request(key);
  }

  private recordWorldCommit(commit: WorldCommitResult): void {
    this.pendingCommits.push(commit);
    queueBodyRecoveriesAfterCommit(commit, this.server.queryEntities(), (entityId, maxDistance) =>
      this.session.requestBodyRecovery(entityId, 'external-geometry-change', maxDistance),
    );
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

  private applyLogicAction(entityId: string, action: LogicIntentBatch['intents'][number]['action']) {
    return action ? this.server.applyActorAuthorityAction(entityId, action) : null;
  }

  private validLogicIntent(intent: LogicIntentBatch['intents'][number]): boolean {
    if (
      !Number.isFinite(intent.wish.x) ||
      !Number.isFinite(intent.wish.z) ||
      ![-1, 0, 1].includes(intent.verticalIntent)
    )
      return false;
    const action = intent.action;
    if (!action) return true;
    if (action.type === 'move-to') return action.target.length === 3 && action.target.every(Number.isFinite);
    if (action.type === 'start-existing-action') return Boolean(action.actionId.trim());
    return Boolean(action.targetId.trim());
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
