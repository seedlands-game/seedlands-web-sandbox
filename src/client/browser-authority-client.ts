import type { AuthoritySnapshot } from '../server/authority/authority-session';
import type { CommandResult, CommandSource, ServerCommand } from '../server/commands/command-contract';
import type { FluidCandidate, FluidAuthoritySnapshot } from '../server/fluid/fluid-transaction';
import type { WorldCommitResult } from '../server/game-server-types';
import { legacyFluid } from '../server/fluid/fluid-cell-state';
import type { VoxelEdit } from '../server/world-mutation';
import {
  PROTOCOL_VERSION,
  type InputCommand,
  type SequenceDecision,
  type SessionEpoch,
} from '../runtime/session-protocol';
import { CHUNK_SIZE, Voxel, chunkKey, floorDiv, mod, voxelIndex } from '../world/voxel';
import type { SerializedChunkSnapshot } from './browser-chunk-persistence';
import type { WorldOpenMode } from './world-version-policy';
import type {
  AuthorityAction,
  AuthorityActionResult,
  AuthorityGameplayView,
  AuthorityMeshPayload,
  AuthorityReady,
  AuthorityRequest,
  AuthorityResponse,
} from '../worker/authority-worker-protocol';
import type { LogicIntentBatch, LogicObservation } from '../server/logic/logic-protocol';

export type AuthorityWorkerPort = {
  onmessage: ((event: MessageEvent<AuthorityResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
};

type ClientOptions = Readonly<{
  onSnapshot?: (snapshot: AuthoritySnapshot) => void;
  onGameplay?: (view: AuthorityGameplayView) => void;
  onCommit?: (commit: WorldCommitResult) => void;
  onFluidWork?: (snapshot: FluidAuthoritySnapshot) => void;
  onLogicObservation?: (observation: LogicObservation) => void;
  onBootstrapGeneration?: (request: { seed: number; generatorVersion: number }) => Promise<[number, number, number]>;
  onUnknownChunk?: (key: string) => void;
  onInputDecision?: (decision: { sequence: number; decision: SequenceDecision; requiresResync: boolean }) => void;
  onFatal?: (error: Error) => void;
}>;

type StartOptions = Readonly<{
  seedText: string;
  openMode: WorldOpenMode;
  legacySnapshots: readonly SerializedChunkSnapshot[];
  initialWorldTime: number;
}>;

type CachedMesh = {
  canonical: Uint16Array;
  fluid: Uint8Array;
  chunkRevision: number;
};

type CachedPreparation = {
  payload: AuthorityMeshPayload;
  canonical?: Uint16Array;
  fluid?: Uint8Array;
  overlays: Array<{ cx: number; cy: number; cz: number; voxels: Uint16Array; fluid?: Uint8Array }>;
};

type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class BrowserAuthorityClient {
  private requestSequence = 0;
  private readonly transactionSequences = new Map<string, number>();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly meshLoads = new Map<string, Promise<void>>();
  private readonly meshCache = new Map<string, CachedMesh>();
  private readonly preparationCache = new Map<string, CachedPreparation>();
  private readyValue: AuthorityReady | null = null;
  private snapshotValue: AuthoritySnapshot | null = null;
  private gameplayValue: AuthorityGameplayView | null = null;
  private resolveReady: ((ready: AuthorityReady) => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private disposed = false;
  private storageBytesValue = 0;

  constructor(
    private readonly worker: AuthorityWorkerPort,
    readonly epoch: SessionEpoch,
    private readonly options: ClientOptions = {},
  ) {
    worker.onmessage = (event) => this.receive(event.data);
    worker.onerror = (event) => this.failAll(new Error(event.message || 'Authority Worker failed.'));
  }

  static create(epoch: SessionEpoch, options: ClientOptions = {}) {
    return new BrowserAuthorityClient(
      new Worker(new URL('../worker/authority-worker.ts', import.meta.url), { type: 'module' }),
      epoch,
      options,
    );
  }

  start(options: StartOptions): Promise<AuthorityReady> {
    if (this.disposed) return Promise.reject(new Error('Authority client is disposed.'));
    if (this.resolveReady || this.readyValue) return Promise.reject(new Error('Authority client already started.'));
    const ready = new Promise<AuthorityReady>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.post({
      kind: 'start-authority',
      protocolVersion: PROTOCOL_VERSION,
      epoch: this.epoch,
      seedText: options.seedText,
      openMode: options.openMode,
      legacySnapshots: options.legacySnapshots,
      initialWorldTime: options.initialWorldTime,
      sessionTimeOriginMs: performance.now(),
    });
    return ready;
  }

  get readyState(): AuthorityReady | null {
    return this.readyValue;
  }

  get isReady(): boolean {
    return Boolean(this.readyValue) && !this.disposed;
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

  sendInput(command: InputCommand): void {
    this.post(command);
  }

  pause(): void {
    this.post({ kind: 'pause-authority', protocolVersion: PROTOCOL_VERSION, epoch: this.epoch });
  }

  resume(): void {
    this.post({ kind: 'resume-authority', protocolVersion: PROTOCOL_VERSION, epoch: this.epoch });
  }

  ensureChunkNeighborhood(cx: number, cy: number, cz: number): Promise<void> {
    const key = chunkKey(cx, cy, cz);
    const inFlight = this.meshLoads.get(key);
    if (inFlight) return inFlight;
    const requestId = ++this.requestSequence;
    const request = new Promise<void>((resolve, reject) =>
      this.pending.set(requestId, { resolve: () => resolve(), reject }),
    ).finally(() => this.meshLoads.delete(key));
    this.meshLoads.set(key, request);
    this.post({
      kind: 'prepare-mesh',
      protocolVersion: PROTOCOL_VERSION,
      epoch: this.epoch,
      requestId,
      cx,
      cy,
      cz,
    });
    return request;
  }

  releaseChunkNeighborhood(cx: number, cy: number, cz: number): void {
    const key = chunkKey(cx, cy, cz);
    this.meshCache.delete(key);
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
    task: Readonly<{
      chunkKey: string;
      cx: number;
      cy: number;
      cz: number;
      chunkRevision: number;
      generatorVersion: number;
    }>,
    result: Readonly<{ canonical?: ArrayBuffer; generatorVersion?: number }>,
  ): Promise<boolean> {
    if (!result.canonical || result.generatorVersion !== task.generatorVersion) return false;
    const canonical = new Uint16Array(result.canonical).slice();
    const authorityCanonical = canonical.slice();
    const response = (await this.request(
      {
        kind: 'accept-generated-chunk',
        key: task.chunkKey,
        cx: task.cx,
        cy: task.cy,
        cz: task.cz,
        chunkRevision: task.chunkRevision,
        generatorVersion: task.generatorVersion,
        canonical: authorityCanonical.buffer,
      },
      [authorityCanonical.buffer],
    )) as { accepted: boolean };
    if (!response.accepted) return false;
    const prepared = this.preparationCache.get(task.chunkKey);
    this.meshCache.set(task.chunkKey, {
      canonical,
      fluid: prepared?.fluid?.slice() ?? legacyFluid(canonical),
      chunkRevision: task.chunkRevision,
    });
    return true;
  }

  getVoxel(x: number, y: number, z: number): number {
    const cached = this.meshCache.get(
      chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)),
    );
    if (!cached) return Voxel.Air;
    return cached.canonical[voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE))];
  }

  getFluidCell(x: number, y: number, z: number): { level: number; source: boolean } | null {
    const cached = this.meshCache.get(
      chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)),
    );
    if (!cached) return null;
    const value = cached.fluid[voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE))];
    const level = value & 0x0f;
    return level ? { level, source: (value & 0x80) !== 0 } : null;
  }

  getChunkRevision(cx: number, cy: number, cz: number): number | null {
    return this.meshCache.get(chunkKey(cx, cy, cz))?.chunkRevision ?? null;
  }

  setFluidActiveChunks(keys: readonly string[]): void {
    this.post({
      kind: 'set-fluid-active-chunks',
      protocolVersion: PROTOCOL_VERSION,
      epoch: this.epoch,
      keys,
    });
  }

  editWorld(actorId: string, edits: readonly VoxelEdit[]): Promise<WorldCommitResult> {
    return this.request({ kind: 'world-edit', actorId, edits }, [], 'world-edit') as Promise<WorldCommitResult>;
  }

  setPlayerPosition(position: [number, number, number]): Promise<unknown> {
    return this.request({ kind: 'set-player-position', position }, [], 'teleport');
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
    this.failAll(new Error('Authority client was disposed.'));
    this.meshCache.clear();
    this.preparationCache.clear();
  }

  private request(
    payload: Record<string, unknown>,
    transfer: Transferable[] = [],
    transactionStream?: string,
  ): Promise<unknown> {
    const requestId = ++this.requestSequence;
    const promise = new Promise((resolve, reject) => this.pending.set(requestId, { resolve, reject }));
    const transaction = transactionStream
      ? {
          issuer: `browser:${this.epoch}`,
          stream: transactionStream,
          sequence: (this.transactionSequences.get(transactionStream) ?? -1) + 1,
        }
      : undefined;
    if (transaction) this.transactionSequences.set(transactionStream!, transaction.sequence);
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
    return promise;
  }

  private post(message: AuthorityRequest, transfer: Transferable[] = []): void {
    if (this.disposed) return;
    this.worker.postMessage(message, transfer);
  }

  private receive(message: AuthorityResponse): void {
    if (this.disposed || message.protocolVersion !== PROTOCOL_VERSION || message.epoch !== this.epoch) return;
    switch (message.kind) {
      case 'authority-ready':
        this.readyValue = message.ready;
        this.snapshotValue = message.ready.snapshot;
        this.updateGameplay(message.ready.gameplay);
        this.resolveReady?.(message.ready);
        this.resolveReady = null;
        this.rejectReady = null;
        break;
      case 'authority-bootstrap-needed':
        void this.provideBootstrap(message);
        break;
      case 'authority-chunk-needed':
        this.options.onUnknownChunk?.(message.key);
        break;
      case 'authority-snapshot':
        this.snapshotValue = message.snapshot;
        if (message.gameplay) this.updateGameplay(message.gameplay);
        message.commits?.forEach((commit) => this.options.onCommit?.(commit));
        this.options.onSnapshot?.(message.snapshot);
        break;
      case 'input-decision':
        this.options.onInputDecision?.({
          sequence: message.sequence,
          decision: message.decision,
          requiresResync: message.requiresResync,
        });
        break;
      case 'authority-response': {
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        this.pending.delete(message.requestId);
        if (!message.ok) pending.reject(new Error(message.error));
        else {
          if (message.gameplay) this.updateGameplay(message.gameplay);
          message.commits?.forEach((commit) => this.options.onCommit?.(commit));
          pending.resolve(message.result);
        }
        break;
      }
      case 'mesh-prepared': {
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        this.pending.delete(message.requestId);
        const payload = message.payload;
        this.preparationCache.set(payload.key, {
          payload,
          ...(payload.canonical ? { canonical: new Uint16Array(payload.canonical) } : {}),
          ...(payload.fluid ? { fluid: new Uint8Array(payload.fluid) } : {}),
          overlays: payload.overlays.map((overlay) => ({
            cx: overlay.cx,
            cy: overlay.cy,
            cz: overlay.cz,
            voxels: new Uint16Array(overlay.voxels),
            ...(overlay.fluid ? { fluid: new Uint8Array(overlay.fluid) } : {}),
          })),
        });
        pending.resolve(undefined);
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
    this.gameplayValue = view;
    this.options.onGameplay?.(view);
  }

  private async provideBootstrap(message: Extract<AuthorityResponse, { kind: 'authority-bootstrap-needed' }>) {
    try {
      if (!this.options.onBootstrapGeneration)
        throw new Error('Authority requested safe spawn generation without a compute provider.');
      const playerBodyPosition = await this.options.onBootstrapGeneration({
        seed: message.seed,
        generatorVersion: message.generatorVersion,
      });
      this.post({
        kind: 'authority-bootstrap-result',
        protocolVersion: PROTOCOL_VERSION,
        epoch: this.epoch,
        requestId: message.requestId,
        playerBodyPosition,
      });
    } catch (error) {
      this.failAll(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private requireReady(): AuthorityReady {
    if (!this.readyValue) throw new Error('Authority client is not ready.');
    return this.readyValue;
  }

  private failAll(error: Error): void {
    this.rejectReady?.(error);
    this.resolveReady = null;
    this.rejectReady = null;
    this.pending.forEach((pending) => pending.reject(error));
    this.pending.clear();
    this.options.onFatal?.(error);
  }
}
