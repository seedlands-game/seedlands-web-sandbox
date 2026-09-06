import type { CommandResult, CommandSource, ServerCommand } from '../server/commands/command-contract';
import type { AuthoritySnapshot } from '../server/authority/authority-session';
import type { FluidCandidate } from '../server/fluid/fluid-transaction';
import type { WorldCommitResult } from '../server/game-server-types';
import type { VoxelEdit } from '../server/world-mutation';
import { PROTOCOL_VERSION, type InputCommand, type SessionEpoch } from '../runtime/session-protocol';
import { chunkKey } from '../world/voxel';
import type {
  AuthorityAction,
  AuthorityActionResult,
  AuthorityGameplayView,
  AuthorityMeshPayload,
  AuthorityPlayerPositionResult,
  AuthorityReady,
  AuthorityRequest,
  AuthorityResponse,
  AuthoritySessionControlResult,
} from '../worker/authority-worker-protocol';
import type { LogicIntentBatch } from '../server/logic/logic-protocol';
import { AuthoritySnapshotGate } from './authority-snapshot-gate';
import { ClientRequestRegistry } from './client-request-registry';
import { ClientReadyWait } from './client-ready-wait';
import { createAuthorityTransport } from './authority-transport';
import { acceptAuthorityMeshPreparation } from './authority-mesh-preparation';
import {
  AuthorityCollisionBaselineClient,
  type AuthorityCollisionBaselinePayload,
} from './authority-collision-baseline-client';
import {
  AuthorityCollisionRevisionGuard,
  acceptAuthorityCollisionBaseline,
  publishAuthorityCollisionCommits,
} from './authority-collision-mirror';
import { AuthorityBootstrapCoordinator } from './authority-bootstrap-client';
import { matchesPreparedVisibilityCanonical, type VisibilityTask } from './authority-prepared-mesh-visibility';
import type {
  AuthorityClientOptions,
  AuthorityCachedMesh,
  AuthorityCachedPreparation,
  AuthorityStartOptions,
} from './browser-authority-client-contract';
export type AuthorityWorkerPort = import('./browser-authority-client-contract').AuthorityWorkerPort;

const failedClientError = (failure: Error) =>
  new Error(`Authority client failed: ${failure.message}`, { cause: failure });

export class BrowserAuthorityClient {
  private requestSequence = 0;
  private readonly transactionSequences = new Map<string, number>();
  private readonly requests: ClientRequestRegistry;
  private readonly snapshotGate: AuthoritySnapshotGate;
  private readonly bootstrap: AuthorityBootstrapCoordinator;
  private readonly meshLoads = new Map<string, Promise<void>>();
  private readonly meshCache = new Map<string, AuthorityCachedMesh>();
  private readonly collisionRevisions = new AuthorityCollisionRevisionGuard();
  private readonly collisionBaselines = new AuthorityCollisionBaselineClient(
    this.meshCache,
    this.collisionRevisions,
    (request) => this.request(request) as Promise<AuthorityCollisionBaselinePayload>,
  );
  private readonly preparationCache = new Map<string, AuthorityCachedPreparation>();
  private readyValue: AuthorityReady | null = null;
  private snapshotValue: AuthoritySnapshot | null = null;
  private gameplayValue: AuthorityGameplayView | null = null;
  private readonly readyWait: ClientReadyWait<AuthorityReady>;
  private disposed = false;
  private failureValue: Error | null = null;
  private storageBytesValue = 0;
  private lastInputDecisionSequence = -1;

  constructor(
    private readonly worker: AuthorityWorkerPort,
    readonly epoch: SessionEpoch,
    private readonly options: AuthorityClientOptions = {},
  ) {
    this.requests = new ClientRequestRegistry(options.requestTimeoutMs);
    this.readyWait = new ClientReadyWait(options.requestTimeoutMs);
    this.snapshotGate = new AuthoritySnapshotGate(epoch);
    this.bootstrap = new AuthorityBootstrapCoordinator(
      options.onBootstrapGeneration,
      (request, transfer) => this.post(request, transfer),
      (error) => this.failAll(error),
    );
    worker.onmessage = (event) => this.receive(event.data);
    worker.onerror = (event) => this.failAll(new Error(event.message || 'Authority Worker failed.'));
  }

  static create(epoch: SessionEpoch, options: AuthorityClientOptions = {}) {
    const raw = new Worker(new URL('../worker/authority-worker.ts', import.meta.url), { type: 'module' });
    return new BrowserAuthorityClient(
      createAuthorityTransport(raw, options.transportFaults ?? { harnessEnabled: false }),
      epoch,
      options,
    );
  }

  start(options: AuthorityStartOptions): Promise<AuthorityReady> {
    if (this.disposed) return Promise.reject(new Error('Authority client is disposed.'));
    if (this.failureValue) return Promise.reject(failedClientError(this.failureValue));
    if (this.readyWait.pending || this.readyValue)
      return Promise.reject(new Error('Authority client already started.'));
    const ready = this.readyWait.start();
    try {
      this.post({
        kind: 'start-authority',
        protocolVersion: PROTOCOL_VERSION,
        epoch: this.epoch,
        seedText: options.seedText,
        openMode: options.openMode,
        legacySnapshots: options.legacySnapshots,
        initialWorldTime: options.initialWorldTime,
        sessionTimeOriginMs: performance.now(),
        frequencies: options.frequencies,
      });
    } catch (error) {
      this.readyWait.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return ready;
  }

  get readyState(): AuthorityReady | null {
    return this.readyValue;
  }

  get isReady(): boolean {
    return Boolean(this.readyValue) && !this.disposed && !this.failureValue;
  }

  get snapshot(): AuthoritySnapshot | null {
    return this.snapshotValue;
  }

  get gameplay(): AuthorityGameplayView {
    if (!this.gameplayValue) throw new Error('Authority gameplay view is not ready.');
    return this.gameplayValue;
  }

  get seed(): number {
    return this.requireReady().seed;
  }

  get seedText(): string {
    return this.requireReady().seedText;
  }

  get generatorVersion(): number {
    return this.requireReady().generatorVersion;
  }

  get worldTime(): number {
    return this.snapshotValue?.worldTime ?? this.requireReady().worldTime;
  }

  get worldRevision(): number {
    return this.snapshotValue?.worldRevision ?? 0;
  }

  get mutationCount(): number {
    return this.snapshotValue?.worldMutationCount ?? 0;
  }

  get physicsTick(): number {
    return this.snapshotValue?.physicsTick ?? 0;
  }

  get commitSequence(): number {
    return this.snapshotValue?.commitSequence ?? 0;
  }

  get storageBytes(): number {
    return this.storageBytesValue;
  }

  get estimatedOneWayLatencyMs(): number {
    return this.options.transportFaults?.latencyMs ?? 0;
  }

  get snapshotRejections() {
    return this.snapshotGate.rejected;
  }

  sendInput(command: InputCommand): void {
    this.post(command);
  }

  pause(): Promise<{ paused: true }> {
    return this.controlSession(true);
  }

  resume(): Promise<{ paused: false }> {
    return this.controlSession(false);
  }

  ensureChunkNeighborhood(cx: number, cy: number, cz: number): Promise<void> {
    const key = chunkKey(cx, cy, cz);
    const inFlight = this.meshLoads.get(key);
    if (inFlight) return inFlight;
    const requestId = ++this.requestSequence;
    const baselineLease = this.collisionRevisions.beginBaseline(key);
    const request = this.requests
      .create(requestId)
      .then((value) => {
        const prepared = acceptAuthorityMeshPreparation(
          value as AuthorityMeshPayload,
          key,
          this.meshCache,
          this.collisionRevisions,
          baselineLease,
        );
        if (prepared) this.preparationCache.set(key, prepared);
      })
      .finally(() => {
        this.collisionRevisions.finishBaseline(baselineLease);
        if (this.meshLoads.get(key) === request) this.meshLoads.delete(key);
      });
    this.meshLoads.set(key, request);
    try {
      this.post({
        kind: 'prepare-mesh',
        protocolVersion: PROTOCOL_VERSION,
        epoch: this.epoch,
        requestId,
        cx,
        cy,
        cz,
      });
    } catch (error) {
      this.requests.reject(requestId, error instanceof Error ? error : new Error(String(error)));
    }
    return request;
  }

  releaseChunkNeighborhood(cx: number, cy: number, cz: number): void {
    const key = chunkKey(cx, cy, cz);
    this.meshLoads.delete(key);
    this.meshCache.delete(key);
    this.collisionRevisions.release(key);
    this.releasePreparation(cx, cy, cz);
  }

  releasePreparation(cx: number, cy: number, cz: number): void {
    const key = chunkKey(cx, cy, cz);
    this.preparationCache.delete(key);
    this.post({ kind: 'release-mesh', protocolVersion: PROTOCOL_VERSION, epoch: this.epoch, cx, cy, cz });
  }

  prepareWorkerInput(cx: number, cy: number, cz: number) {
    const cached = this.preparationCache.get(chunkKey(cx, cy, cz));
    if (!cached) throw new Error(`Authority worker input is not prepared for ${cx},${cy},${cz}.`);
    return {
      chunkRevision: cached.payload.chunkRevision,
      generatorVersion: cached.payload.generatorVersion,
      ...(cached.payload.preparationDiagnostics
        ? { preparationDiagnostics: cached.payload.preparationDiagnostics }
        : {}),
      ...(cached.canonical ? { canonical: cached.canonical.slice() } : {}),
      ...(cached.fluid ? { fluid: cached.fluid.slice() } : {}),
      overlays: cached.overlays.map((overlay) => ({
        cx: overlay.cx,
        cy: overlay.cy,
        cz: overlay.cz,
        voxels: overlay.voxels.slice(),
        ...(overlay.fluid ? { fluid: overlay.fluid.slice() } : {}),
      })),
    };
  }

  async acceptWorkerCanonical(
    task: VisibilityTask,
    result: Readonly<{ canonical?: ArrayBuffer; generatorVersion?: number }>,
  ): Promise<boolean> {
    const prepared = this.preparationCache.get(task.chunkKey);
    return acceptAuthorityCollisionBaseline({
      key: task.chunkKey,
      chunkRevision: task.chunkRevision,
      generatorVersion: task.generatorVersion,
      result,
      preparedFluid: this.preparationCache.get(task.chunkKey)?.fluid,
      chunks: this.meshCache,
      guard: this.collisionRevisions,
      accept: async (canonical) => {
        if (matchesPreparedVisibilityCanonical(task, prepared, canonical)) return true;
        const response = (await this.request(
          { kind: 'accept-generated-chunk', ...task, key: task.chunkKey, canonical: canonical.buffer },
          [canonical.buffer],
        )) as { accepted: boolean };
        return response.accepted;
      },
    });
  }

  getVoxel(x: number, y: number, z: number): number {
    return this.collisionBaselines.getVoxel(x, y, z);
  }

  getFluidCell(x: number, y: number, z: number): { level: number; source: boolean } | null {
    return this.collisionBaselines.getFluidCell(x, y, z);
  }

  getChunkRevision(cx: number, cy: number, cz: number): number | null {
    return this.collisionBaselines.getChunkRevision(cx, cy, cz);
  }

  setFluidActiveChunks(keys: readonly string[]): void {
    this.post({
      kind: 'set-fluid-active-chunks',
      protocolVersion: PROTOCOL_VERSION,
      epoch: this.epoch,
      keys,
    });
  }

  async editWorld(actorId: string, edits: readonly VoxelEdit[]): Promise<WorldCommitResult> {
    return this.request({ kind: 'world-edit', actorId, edits }, [], 'world-edit') as Promise<WorldCommitResult>;
  }

  async setPlayerPosition(position: [number, number, number]): Promise<AuthorityPlayerPositionResult> {
    const result = (await this.request(
      { kind: 'set-player-position', position },
      [],
      'teleport',
    )) as AuthorityPlayerPositionResult;
    this.acceptSnapshot(result.snapshot);
    return result;
  }

  performAction(action: AuthorityAction): Promise<AuthorityActionResult> {
    return this.request({ kind: 'gameplay-action', action }, [], 'gameplay-action') as Promise<AuthorityActionResult>;
  }

  executeCommand(source: CommandSource, command: ServerCommand): Promise<CommandResult> {
    return this.request({ kind: 'server-command', source, command }, [], 'server-command') as Promise<CommandResult>;
  }

  setWorldTime(hours: number): Promise<{ worldTime: number }> {
    return this.request({ kind: 'set-world-time', hours }, [], 'world-time') as Promise<{ worldTime: number }>;
  }

  setWorldClockRate(rate: number): Promise<{ rate: number }> {
    return this.request({ kind: 'set-world-clock-rate', rate }, [], 'world-clock-rate') as Promise<{ rate: number }>;
  }

  async save(): Promise<{
    savedChunks: string[];
    gameplaySaved: boolean;
    commitSequence: number;
    storageBytes: number;
  }> {
    const result = (await this.request({ kind: 'save-authority' })) as {
      savedChunks: string[];
      gameplaySaved: boolean;
      commitSequence: number;
      storageBytes: number;
    };
    this.storageBytesValue = result.storageBytes;
    return result;
  }

  commitFluid(candidate: FluidCandidate): void {
    this.post({ kind: 'fluid-candidate', protocolVersion: PROTOCOL_VERSION, epoch: this.epoch, candidate });
  }

  failFluid(workId: string, reason: string): void {
    this.post({ kind: 'fluid-failure', protocolVersion: PROTOCOL_VERSION, epoch: this.epoch, workId, reason });
  }

  sendLogicIntents(batch: LogicIntentBatch): void {
    this.post({
      kind: 'logic-intents',
      protocolVersion: PROTOCOL_VERSION,
      epoch: this.epoch,
      batch,
    });
  }

  requestLogicObservation(): void {
    this.post({
      kind: 'request-logic-observation',
      protocolVersion: PROTOCOL_VERSION,
      epoch: this.epoch,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.post({ kind: 'dispose-authority', protocolVersion: PROTOCOL_VERSION, epoch: this.epoch });
    this.disposed = true;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.cancelAll(new Error('Authority client was disposed.'));
    this.meshCache.clear();
    this.collisionRevisions.clear();
    this.preparationCache.clear();
  }

  private request(
    payload: Record<string, unknown>,
    transfer: Transferable[] = [],
    transactionStream?: string,
  ): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error('Authority client is disposed.'));
    if (this.failureValue) return Promise.reject(failedClientError(this.failureValue));
    const requestId = ++this.requestSequence;
    const promise = this.requests.create(requestId);
    const transaction = transactionStream
      ? {
          issuer: `browser:${this.epoch}`,
          stream: transactionStream,
          sequence: (this.transactionSequences.get(transactionStream) ?? -1) + 1,
        }
      : undefined;
    if (transaction) this.transactionSequences.set(transactionStream!, transaction.sequence);
    try {
      this.post(
        {
          ...payload,
          protocolVersion: PROTOCOL_VERSION,
          epoch: this.epoch,
          requestId,
          ...(transaction ? { transaction } : {}),
        } as AuthorityRequest,
        transfer,
      );
    } catch (error) {
      this.requests.reject(requestId, error instanceof Error ? error : new Error(String(error)));
    }
    return promise;
  }

  private post(message: AuthorityRequest, transfer: Transferable[] = []): void {
    if (this.disposed || this.failureValue) return;
    this.worker.postMessage(message, transfer);
  }

  private receive(message: AuthorityResponse): void {
    if (
      this.disposed ||
      this.failureValue ||
      message.protocolVersion !== PROTOCOL_VERSION ||
      message.epoch !== this.epoch
    )
      return;
    switch (message.kind) {
      case 'authority-ready':
        if (!this.readyWait.pending) return;
        if (this.snapshotGate.accept(message.ready.snapshot)) return;
        this.readyValue = message.ready;
        this.snapshotValue = message.ready.snapshot;
        this.collisionRevisions.initializeCommitDelivery(message.ready.snapshot.worldRevision);
        this.updateGameplay(message.ready.gameplay);
        this.readyWait.resolve(message.ready);
        break;
      case 'authority-bootstrap-needed':
        this.bootstrap.receive(message);
        break;
      case 'authority-chunk-needed':
        this.options.onAuthorityChunkNeeded?.(message.key);
        break;
      case 'authority-snapshot':
        this.acceptSnapshot(message.snapshot, message.gameplay, message.commits);
        break;
      case 'input-decision':
        if (message.sequence <= this.lastInputDecisionSequence) return;
        this.lastInputDecisionSequence = message.sequence;
        this.options.onInputDecision?.({
          sequence: message.sequence,
          decision: message.decision,
          requiresResync: message.requiresResync,
        });
        break;
      case 'authority-response': {
        if (!this.requests.has(message.requestId)) return;
        if (!message.ok) this.requests.reject(message.requestId, new Error(message.error));
        else {
          if (message.gameplay) this.updateGameplay(message.gameplay);
          publishAuthorityCollisionCommits(message.commits, this.meshCache, this.options, this.collisionRevisions);
          this.requests.resolve(message.requestId, message.result);
        }
        break;
      }
      case 'mesh-prepared': {
        if (!this.requests.has(message.requestId)) return;
        this.requests.resolve(message.requestId, message.payload);
        break;
      }
      case 'fluid-work':
        this.options.onFluidWork?.(message.snapshot);
        break;
      case 'logic-observation':
        this.options.onLogicObservation?.(message.observation);
        break;
      case 'authority-fatal':
        this.failAll(new Error(message.error));
        break;
    }
  }

  private updateGameplay(view: AuthorityGameplayView): void {
    if (this.gameplayValue && view.gameplayRevision <= this.gameplayValue.gameplayRevision) return;
    this.gameplayValue = view;
    this.options.onGameplay?.(view);
  }

  private acceptSnapshot(
    snapshot: AuthoritySnapshot,
    gameplay?: AuthorityGameplayView,
    commits?: readonly WorldCommitResult[],
  ): void {
    publishAuthorityCollisionCommits(commits, this.meshCache, this.options, this.collisionRevisions);
    if (gameplay) this.updateGameplay(gameplay);
    if (this.snapshotGate.accept(snapshot)) return;
    this.snapshotValue = snapshot;
    this.collisionBaselines.synchronize(snapshot.chunkRevisions);
    this.options.onSnapshot?.(snapshot);
  }

  private requireReady(): AuthorityReady {
    if (!this.readyValue) throw new Error('Authority client is not ready.');
    return this.readyValue;
  }

  private async controlSession<Paused extends boolean>(paused: Paused): Promise<{ paused: Paused }> {
    try {
      const result = (await this.request(
        { kind: paused ? 'pause-authority' : 'resume-authority' },
        [],
        'session-control',
      )) as Partial<AuthoritySessionControlResult>;
      if (result.paused !== paused || !result.snapshot || result.snapshot.paused !== paused)
        throw new Error('Authority session control acknowledgement is invalid.');
      this.acceptSnapshot(result.snapshot);
      return { paused };
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.failAll(failure);
      throw failure;
    }
  }

  private failAll(error: Error): void {
    if (this.failureValue) return;
    this.failureValue = error;
    this.cancelAll(error);
    this.options.onFatal?.(error);
  }

  private cancelAll(error: Error): void {
    this.readyWait.reject(error);
    this.requests.rejectAll(error);
  }
}
