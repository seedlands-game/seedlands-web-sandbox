import type { EntityLifetimeReference } from '../gameplay/entity-store';
import { bodyConfigFor, bodyKindForEntity } from '../../physics/body-registry';
import { TransactionDeduplicator, type InputCommand, type SequenceDecision } from '../../runtime/session-protocol';
import type {
  AuthorityAction,
  AuthorityActionResult,
  AuthorityGameplayView,
  AuthorityMeshPayload,
  AuthorityReady,
} from '../../compute/authority-worker-protocol';
import { GameServer } from '../game-server';
import type { WorkerCanonicalResult, WorldCommitResult } from '../game-server-types';
import type { FluidCandidate } from '../fluid/fluid-transaction';
import type { VoxelEdit } from '../world-mutation';
import { ServerCommandExecutor } from '../commands/server-command-executor';
import type { CommandSource, ServerCommand } from '../commands/command-contract';
import { AuthoritySession, type AuthoritySnapshot, type LogicIntent } from './authority-session';
import { AuthorityLogicObservationBuilder } from './logic-observation-builder';
import { LOGIC_PROTOCOL_VERSION, type LogicIntentBatch, type LogicObservation } from '../logic/logic-protocol';
import { CHUNK_SIZE, chunkKey } from '../../world/voxel';
import type * as R from './authority-runtime-types';
import { createAuthorityAdvanceCommandPort } from './authority-command-advance';
import type { AuthorityTransactionIdentity, AuthorityTransactionReceipt } from './authority-runtime-types';
import { AuthorityResidencyRuntime, type AuthorityResidencyDiagnostics } from './authority-residency-runtime';
import { advanceAuthoritySession, advancePausedAuthoritySession } from './authority-session-advance';
import { withAuthorityResidencyDiagnostics } from './authority-snapshot-diagnostics';
import { AuthorityMutationPreparation, unavailableWorldCommit } from './authority-mutation-preparation';
import { applyAuthorityPlayerAction, unavailableAuthorityPlayerAction } from './authority-player-action';
import { queueBodyRecoveriesAfterCommit } from './authority-geometry-recovery';
import { AuthorityCanonicalPreparation, createAuthorityCanonicalRouter } from './authority-canonical-preparation';
import { prepareAuthorityMeshPayload } from './authority-mesh-payload';
import type { AuthorityRuntimeOptions } from './authority-runtime-options';
import { AuthorityLogicCandidates } from './authority-logic-candidates';
import { acceptLogicIntentBatch, isValidLogicIntent } from './authority-logic-intent-acceptance';

export type * from './authority-runtime-types';
export type { AuthorityRuntimeOptions } from './authority-runtime-options';

export type { AuthorityResidencyDiagnostics } from './authority-residency-runtime';

export class AuthorityRuntime {
  readonly server: GameServer;
  readonly playerId: string;
  readonly frequencies: R.AuthorityFrequencies;
  private readonly session: AuthoritySession;
  private readonly newPlayer: boolean;
  private readonly initialBodyPosition: [number, number, number];
  private pendingCommits: WorldCommitResult[] = [];
  private readonly logicCandidates = new AuthorityLogicCandidates();
  private readonly logicObservationBuilder: AuthorityLogicObservationBuilder;
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
    this.mutationPreparation = new AuthorityMutationPreparation(
      server,
      (key) => this.requestUnknownChunk(key),
      options.platform.timers,
    );
    this.canonicalPreparation = new AuthorityCanonicalPreparation(
      server,
      (key) => options.onUnknownChunk?.(key),
      (key) => this.mutationPreparation.acceptAvailable(key),
    );
    this.logicObservationBuilder = new AuthorityLogicObservationBuilder(options.platform.clone, options.epoch, server);
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
      createEntityReference: (id: string) => server.createEntityReference(id),
      resolveEntityReference: (reference: EntityLifetimeReference) => server.resolveEntityReference(reference) !== null,
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
      measureNow: options.platform.now,
      requestUnknownChunk: (key) => this.requestUnknownChunk(key),
      requestFluidWork: () => this.requestFluidWork(),
      publishLogicObservation: (snapshot) =>
        this.logicCandidates.publish(
          snapshot,
          (sequence, value) => this.logicObservationBuilder.build(sequence, value),
          options.onLogicObservation,
        ),
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
      ...(options.fluidEpoch === undefined ? {} : { fluidEpoch: options.fluidEpoch }),
      platform: options.platform,
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
    const startTimeMs = options.startClock?.() ?? options.startTimeMs;
    if (!Number.isFinite(startTimeMs)) throw new TypeError('Authority startup clock returned a non-finite value.');
    const runtime = new AuthorityRuntime({ ...options, startTimeMs }, server, player.id, isNew);
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
      snapshot: withAuthorityResidencyDiagnostics(this.session.currentSnapshot, this.residency.diagnostics),
      gameplay: this.view(),
      ...(camp ? { campPosition: [...camp.position] as [number, number, number] } : {}),
    };
  }

  wake(nowMs: number): AuthoritySnapshot {
    const snapshot = this.session.wake(nowMs);
    this.currentTimeMs = nowMs;
    this.residency.maintain(snapshot.activeTimeMs);
    return withAuthorityResidencyDiagnostics(snapshot, this.residency.diagnostics);
  }

  get residencyDiagnostics(): AuthorityResidencyDiagnostics {
    return this.residency.diagnostics;
  }

  get sessionTimeMs(): number {
    return this.currentTimeMs;
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

  advancePausedSession(elapsedMs: number): R.AuthorityAdvanceResult {
    return advancePausedAuthoritySession({
      elapsedMs,
      frequencies: this.frequencies,
      laneTotals: () => this.session.laneTotals,
      currentSnapshot: () => this.snapshot(),
      advancePaused: (slice) => this.session.advancePaused(slice),
      decorate: (snapshot) => withAuthorityResidencyDiagnostics(snapshot, this.residency.diagnostics),
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
    const latestPhysicsTick = this.session.currentSnapshot.physicsTick;
    const observation = this.logicCandidates.consume(batch.observationSequence);
    if (!observation || batch.expiresAtPhysicsTick < latestPhysicsTick) return false;
    const { intents, canonicalChanged } = acceptLogicIntentBatch({
      batch,
      observation,
      latestPhysicsTick,
      physicsHz: this.frequencies.physicsHz,
      currentEntities: this.server.queryEntities(),
      identityRevision: (entity) => this.logicObservationBuilder.identityRevision(entity),
      referenceFor: (id) => this.server.createEntityReference(id),
      currentChunkRevisions: (reads) => this.currentChunkRevisions(reads),
      applyAction: (entityId, action) => this.applyLogicAction(entityId, action),
      validIntent: isValidLogicIntent,
    });
    if (canonicalChanged) this.session.commitExternalState(false);
    return this.session.receiveLogicIntents(batch.epoch, intents);
  }

  createLogicObservation(): LogicObservation {
    return this.logicCandidates.create(this.snapshot(), (sequence, value) =>
      this.logicObservationBuilder.build(sequence, value),
    );
  }

  invalidateLogicCandidates(): void {
    this.logicCandidates.invalidate();
    this.session.clearLogicIntents();
  }

  get settlementDiagnostics() {
    const snapshot = this.snapshot();
    return {
      physicsSettled: snapshot.physicsDebtMs + 1e-7 < 1_000 / this.frequencies.physicsHz,
      fluidIssuedWorkCount: this.server.fluidDiagnostics.issuedLeaseCount ?? 0,
      fluidSettledWorkCount:
        this.server.fluidDiagnostics.settledLeaseCount ??
        this.server.fluidDiagnostics.acceptedCandidateCount + this.server.fluidDiagnostics.returnedLeaseCount,
      logicObservationRequested: this.logicCandidates.requested,
      logicIssuedObservationSequence: this.logicCandidates.issuedSequence,
    } as const;
  }

  hasPendingLogicObservationThrough(sequence: number): boolean {
    return this.logicCandidates.hasPendingThrough(sequence);
  }

  requestLogicObservation = () => this.logicCandidates.request();

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
    return prepareAuthorityMeshPayload(this.server, this.options.platform.now, cx, cy, cz);
  }

  prepareHarnessChunks(chunks: readonly (readonly [number, number, number])[]): Promise<boolean> {
    return this.mutationPreparation.prepareChunks(chunks);
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
    const submittedAction = this.options.platform.clone(action);
    const target =
      submittedAction.type === 'attack' ? this.server.createEntityReference(submittedAction.targetId) : null;
    const rejectStale = (reason: string): AuthorityActionResult => ({
      submittedAction,
      result: { success: false, reason },
      gameplay: this.view(),
      commits: [],
    });
    if (!this.session.playerBindingCurrent) return rejectStale('stale-control-binding');
    if (!(await this.mutationPreparation.prepareAction(submittedAction, this.playerId)))
      return unavailableAuthorityPlayerAction(submittedAction, this.view());
    if (!this.session.playerBindingCurrent) return rejectStale('stale-control-binding');
    if (target && !this.server.resolveEntityReference(target)) return rejectStale('stale-target-lifetime');
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
      now: this.options.platform.now,
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

  exportPortableCheckpoint() {
    return this.server.freezePortableSaveSnapshot(this.session.currentCommitSequence);
  }

  async persistPortableCheckpoint(snapshot: ReturnType<AuthorityRuntime['exportPortableCheckpoint']>) {
    const result = await this.server.saveFrozen(snapshot);
    this.residency.recordSaveSuccess();
    return result;
  }

  view(): AuthorityGameplayView {
    const entities = this.server
      .queryEntities()
      .map((entity) =>
        entity.type === 'creature' || entity.type === 'npc'
          ? { ...entity, combat: this.server.getCombatState(entity.id) }
          : entity,
      );
    return {
      gameplayRevision: this.server.gameplayRevision,
      gameplayTime: this.server.gameplayTime,
      player: this.server.getPlayerState(this.playerId),
      entities,
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
