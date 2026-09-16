// prettier-ignore
import type { CommandResult, CommandSource, ServerCommand } from '@seedlands/stdlib/server/commands/command-contract';
import type { AuthoritySnapshot } from '@seedlands/stdlib/server/authority/authority-session';
import type { FluidCandidate } from '@seedlands/stdlib/server/fluid/fluid-transaction';
import type { WorldCommitResult } from '@seedlands/stdlib/server/game-server-types';
import type { VoxelEdit } from '@seedlands/stdlib/server/world-mutation';
import { PROTOCOL_VERSION, type InputCommand, type SessionEpoch } from '@seedlands/stdlib/runtime/session-protocol';
import type {
  AuthorityAction,
  AuthorityActionResult,
  AuthorityGameplayView,
  AuthorityPlayerPositionResult,
  AuthorityReady,
  AuthorityRequest,
  AuthorityResponse,
  AuthoritySessionControlResult,
} from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import type { LogicIntentBatch } from '@seedlands/stdlib/server/logic/logic-protocol';
import type {
  WorldHarnessPort,
  WorldHarnessResult,
  WorldPrepareRequest,
} from '@seedlands/stdlib/server/harness/world-harness-contract';
import type {
  CharacterControlRequest,
  CharacterControlResult,
  ControlBinding,
} from '@seedlands/stdlib/runtime/character-control-protocol';
import { AuthoritySnapshotGate } from './authority-snapshot-gate';
import { ClientRequestRegistry } from '../client-request-registry';
import { ClientReadyWait } from '../client-ready-wait';
import { authorityInputTransitBudgetMs, createAuthorityTransport } from './authority-transport';
import { AuthorityBootstrapCoordinator } from './authority-bootstrap-client';
import type { VisibilityTask } from './authority-prepared-mesh-visibility';
import { BrowserAuthorityChunkClient } from './browser-authority-chunk-client';
import { createBoundCharacterControlPort } from './browser-character-control-port';
import type {
  AuthorityClientOptions,
  BoundCharacterControlPort,
  AuthoritySaveResult,
  AuthorityStartOptions,
} from './browser-authority-client-contract';
import {
  BrowserAuthorityDirectLogic,
  clientFailure,
  type DirectLogicDiagnostics,
} from './browser-authority-direct-logic';
import { createBrowserAuthorityWorldPort } from './browser-authority-world-port';
export type AuthorityWorkerPort = import('./browser-authority-client-contract').AuthorityWorkerPort;

export class BrowserAuthorityClient {
  readonly mode = 'local' as const;
  readonly world: WorldHarnessPort;
  readonly estimatedInputTransitMs: number;
  private requestSequence = 0;
  private readonly transactionSequences = new Map<string, number>();
  private readonly requests: ClientRequestRegistry;
  private snapshotGate: AuthoritySnapshotGate;
  private readonly bootstrap: AuthorityBootstrapCoordinator;
  private readonly chunks: BrowserAuthorityChunkClient;
  private readyValue: AuthorityReady | null = null;
  private snapshotValue: AuthoritySnapshot | null = null;
  private gameplayValue: AuthorityGameplayView | null = null;
  private readonly readyWait: ClientReadyWait<AuthorityReady>;
  private disposed = false;
  private failureValue: Error | null = null;
  private storageBytesValue = 0;
  private storageBytesMeasured = false;
  private lastInputDecisionSequence = -1;
  private runtimeEpochValue: string;
  private readonly directLogic: BrowserAuthorityDirectLogic;

  constructor(
    private readonly worker: AuthorityWorkerPort,
    readonly epoch: SessionEpoch,
    private readonly options: AuthorityClientOptions = {},
  ) {
    this.runtimeEpochValue = epoch;
    this.directLogic = new BrowserAuthorityDirectLogic(worker, epoch);
    this.estimatedInputTransitMs = authorityInputTransitBudgetMs(options.transportFaults ?? { harnessEnabled: false });
    this.requests = new ClientRequestRegistry(options.requestTimeoutMs);
    this.chunks = new BrowserAuthorityChunkClient(
      epoch,
      this.requests,
      (payload, transfer) => this.request(payload, transfer),
      (message, transfer) => this.post(message, transfer),
      options,
    );
    this.readyWait = new ClientReadyWait(options.requestTimeoutMs);
    this.snapshotGate = new AuthoritySnapshotGate(epoch);
    this.bootstrap = new AuthorityBootstrapCoordinator(
      options.onBootstrapGeneration,
      (request, transfer) => this.post(request, transfer),
      (error) => this.failAll(error),
    );
    this.world = createBrowserAuthorityWorldPort(
      (method, ...args) => this.worldRequest(method, ...args),
      async (request) => {
        await this.prepareWorldRequest(request);
        const chunks = request.kind === 'chunk' ? [request.chunk] : request.chunks;
        for (const [cx, cy, cz] of chunks)
          if (!(await this.chunks.refreshCollisionBaseline(cx, cy, cz)))
            throw new Error(`Authority collision baseline is unavailable: ${cx},${cy},${cz}.`);
      },
    );
    worker.onmessage = (event) => this.receive(event.data);
    worker.onerror = (event) => this.failAll(new Error(event.message || 'Authority Worker failed.'));
  }

  static create(epoch: SessionEpoch, options: AuthorityClientOptions = {}) {
    const raw = new Worker(new URL('../../worker/authority-worker.ts', import.meta.url), { type: 'module' });
    return new BrowserAuthorityClient(
      createAuthorityTransport(raw, options.transportFaults ?? { harnessEnabled: false }),
      epoch,
      options,
    );
  }

  attachDirectLogic(port: MessagePort, diagnostics: (value: DirectLogicDiagnostics) => void): void {
    this.directLogic.attach(port, diagnostics, this.disposed || this.readyWait.pending || this.readyValue !== null);
  }

  start(options: AuthorityStartOptions): Promise<AuthorityReady> {
    if (this.disposed) return Promise.reject(new Error('Authority client is disposed.'));
    if (this.failureValue) return Promise.reject(clientFailure(this.failureValue));
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
        developerWorldHarness: options.developerWorldHarness ?? false,
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

  get worldgenProvider(): NonNullable<AuthorityReady['worldgenProvider']> {
    const provider = this.requireReady().worldgenProvider;
    if (!provider) throw new Error('Authority omitted its world-generation provider.');
    return provider;
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

  get storageBytesMeasurement(): number | null {
    return this.storageBytesMeasured ? this.storageBytesValue : null;
  }

  get snapshotRejections() {
    return this.snapshotGate.rejected;
  }

  sendInput(command: InputCommand): void {
    this.post({ ...command, epoch: this.epoch, runtimeEpoch: this.runtimeEpochValue });
  }

  pause(): Promise<{ paused: true }> {
    return this.controlSession(true);
  }

  resume(): Promise<{ paused: false }> {
    return this.controlSession(false);
  }

  ensureChunkNeighborhood(cx: number, cy: number, cz: number): Promise<void> {
    return this.chunks.ensure(cx, cy, cz, ++this.requestSequence);
  }

  releaseChunkNeighborhood(cx: number, cy: number, cz: number): void {
    this.chunks.release(cx, cy, cz);
  }

  releasePreparation(cx: number, cy: number, cz: number): void {
    this.chunks.releasePreparation(cx, cy, cz);
  }

  prepareWorkerInput(cx: number, cy: number, cz: number) {
    return this.chunks.prepareWorkerInput(cx, cy, cz);
  }

  async acceptWorkerCanonical(
    task: VisibilityTask,
    result: Readonly<{
      canonical?: ArrayBuffer;
      generatorVersion?: number;
      provider?: import('@seedlands/kernel/spatial').KernelWorldgenProviderIdentity;
    }>,
  ): Promise<boolean> {
    return this.chunks.acceptCanonical(task, result);
  }

  getVoxel(x: number, y: number, z: number): number {
    return this.chunks.getVoxel(x, y, z);
  }

  getFluidCell(x: number, y: number, z: number): { level: number; source: boolean } | null {
    return this.chunks.getFluidCell(x, y, z);
  }

  getChunkRevision(cx: number, cy: number, cz: number): number | null {
    return this.chunks.getChunkRevision(cx, cy, cz);
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

  character(request: CharacterControlRequest): Promise<WorldHarnessResult<CharacterControlResult>> {
    return this.request({ kind: 'character-control', request }) as Promise<WorldHarnessResult<CharacterControlResult>>;
  }

  async bindCharacter(entityId: string): Promise<BoundCharacterControlPort> {
    const binding = (await this.request({ kind: 'bind-character', entityId })) as ControlBinding;
    return createBoundCharacterControlPort(binding, (request) => this.request(request));
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

  async save(): Promise<AuthoritySaveResult> {
    const result = (await this.request({ kind: 'save-authority' })) as AuthoritySaveResult;
    this.storageBytesValue = result.storageBytes;
    this.storageBytesMeasured = true;
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
    this.directLogic.close();
    this.cancelAll(new Error('Authority client was disposed.'));
    this.chunks.clear();
  }

  private request(
    payload: Record<string, unknown>,
    transfer: Transferable[] = [],
    transactionStream?: string,
  ): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error('Authority client is disposed.'));
    if (this.failureValue) return Promise.reject(clientFailure(this.failureValue));
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
    this.worker.postMessage(
      message.kind === 'start-authority' ? message : { ...message, runtimeEpoch: this.runtimeEpochValue },
      transfer,
    );
  }

  private receive(message: AuthorityResponse | DirectLogicDiagnostics): void {
    if (this.directLogic.receive(message, this.runtimeEpochValue, this.disposed)) return;
    if (
      this.disposed ||
      this.failureValue ||
      message.protocolVersion !== PROTOCOL_VERSION ||
      message.epoch !== this.epoch
    )
      return;
    switch (message.kind) {
      case 'authority-ready': {
        if (!this.readyWait.pending) return;
        const readySnapshotRejection = this.snapshotGate.accept(message.ready.snapshot);
        if (readySnapshotRejection === 'wrong-epoch')
          return this.failAll(new Error('Authority ready snapshot epoch does not match the active session.'));
        this.readyValue = message.ready;
        if (!readySnapshotRejection) this.snapshotValue = message.ready.snapshot;
        this.chunks.initialize(message.ready.snapshot.worldRevision);
        this.updateGameplay(message.ready.gameplay);
        this.readyWait.resolve(message.ready);
        break;
      }
      case 'authority-bootstrap-needed':
        this.bootstrap.receive(message);
        break;
      case 'authority-chunk-needed':
        this.options.onAuthorityChunkNeeded?.(message.key);
        break;
      case 'authority-snapshot':
        this.acceptSnapshot(message.snapshot, message.gameplay, message.commits);
        break;
      case 'authority-commits':
        return this.chunks.publish(message.commits);
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
          this.chunks.publish(message.commits);
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
      case 'world-harness-response':
        if (!this.requests.has(message.requestId)) return;
        if (message.ready) {
          this.storageBytesMeasured = false;
          this.runtimeEpochValue = message.runtimeEpoch ?? message.ready.snapshot.epoch;
          this.snapshotGate = new AuthoritySnapshotGate(this.runtimeEpochValue);
          this.chunks.clear();
          this.readyValue = message.ready;
          this.snapshotValue = null;
          this.gameplayValue = null;
          this.acceptSnapshot(message.ready.snapshot, message.ready.gameplay);
          this.options.onWorldEpochChanged?.(this.runtimeEpochValue, message.ready);
        }
        this.requests.resolve(message.requestId, message.result);
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
    this.chunks.publish(commits);
    if (gameplay) this.updateGameplay(gameplay);
    if (this.snapshotGate.accept(snapshot)) return;
    this.snapshotValue = snapshot;
    this.chunks.synchronize(snapshot);
    this.options.onSnapshot?.(snapshot);
  }

  private requireReady(): AuthorityReady {
    if (!this.readyValue) throw new Error('Authority client is not ready.');
    return this.readyValue;
  }

  private worldRequest<Method extends keyof WorldHarnessPort>(
    method: Method,
    ...args: unknown[]
  ): ReturnType<WorldHarnessPort[Method]> {
    return this.request({ kind: 'world-harness-rpc', method, args }) as ReturnType<WorldHarnessPort[Method]>;
  }

  private async prepareWorldRequest(request: WorldPrepareRequest): Promise<void> {
    const chunks = request.kind === 'chunk' ? [request.chunk] : request.chunks;
    for (const [cx, cy, cz] of chunks) await this.ensureChunkNeighborhood(cx, cy, cz);
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
