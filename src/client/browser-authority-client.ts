import type { AuthoritySnapshot, LogicIntent } from '../server/authority/authority-session';
import type { CommandResult, CommandSource, ServerCommand } from '../server/commands/command-contract';
import type { FluidCandidate, FluidAuthoritySnapshot } from '../server/fluid/fluid-transaction';
import type { WorldCommitResult } from '../server/game-server-types';
import type { VoxelEdit } from '../server/world-mutation';
import { PROTOCOL_VERSION, type InputCommand, type SessionEpoch } from '../runtime/session-protocol';
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
  onLogicObservation?: (sequence: number, snapshot: AuthoritySnapshot) => void;
  onFatal?: (error: Error) => void;
}>;

type StartOptions = Readonly<{
  seedText: string;
  openMode: WorldOpenMode;
  legacySnapshots: readonly SerializedChunkSnapshot[];
  initialWorldTime: number;
}>;

type CachedMesh = {
  payload: AuthorityMeshPayload;
  canonical: Uint16Array;
  halo: Uint16Array;
  fluid: Uint8Array;
  fluidHalo: Uint8Array;
};

type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class BrowserAuthorityClient {
  private requestSequence = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly meshLoads = new Map<string, Promise<void>>();
  private readonly meshCache = new Map<string, CachedMesh>();
  private readyValue: AuthorityReady | null = null;
  private snapshotValue: AuthoritySnapshot | null = null;
  private gameplayValue: AuthorityGameplayView | null = null;
  private resolveReady: ((ready: AuthorityReady) => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private disposed = false;

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
    return this.snapshotValue?.commitSequence ?? 0;
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
    this.meshCache.delete(chunkKey(cx, cy, cz));
    this.post({ kind: 'release-mesh', protocolVersion: PROTOCOL_VERSION, epoch: this.epoch, cx, cy, cz });
  }

  prepareMainSnapshot(cx: number, cy: number, cz: number) {
    const cached = this.meshCache.get(chunkKey(cx, cy, cz));
    if (!cached) throw new Error(`Authority mesh is not prepared for ${cx},${cy},${cz}.`);
    return {
      chunkRevision: cached.payload.chunkRevision,
      haloRevision: cached.payload.haloRevision,
      canonical: cached.canonical.slice(),
      halo: cached.halo.slice(),
      fluid: cached.fluid.slice(),
      fluidHalo: cached.fluidHalo.slice(),
    };
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

  setFluidActiveChunks(keys: readonly string[]): void {
    this.post({
      kind: 'set-fluid-active-chunks',
      protocolVersion: PROTOCOL_VERSION,
      epoch: this.epoch,
      keys,
    });
  }

  editWorld(actorId: string, edits: readonly VoxelEdit[]): Promise<WorldCommitResult> {
    return this.request({ kind: 'world-edit', actorId, edits }) as Promise<WorldCommitResult>;
  }

  setPlayerPosition(position: [number, number, number]): Promise<unknown> {
    return this.request({ kind: 'set-player-position', position });
  }

  performAction(action: AuthorityAction): Promise<AuthorityActionResult> {
    return this.request({ kind: 'gameplay-action', action }) as Promise<AuthorityActionResult>;
  }

  executeCommand(source: CommandSource, command: ServerCommand): Promise<CommandResult> {
    return this.request({ kind: 'server-command', source, command }) as Promise<CommandResult>;
  }

  setWorldTime(hours: number): Promise<{ worldTime: number }> {
    return this.request({ kind: 'set-world-time', hours }) as Promise<{ worldTime: number }>;
  }

  advanceWorldClock(hours: number): void {
    this.post({ kind: 'advance-world-clock', protocolVersion: PROTOCOL_VERSION, epoch: this.epoch, hours });
  }

  save(): Promise<{ savedChunks: string[]; gameplaySaved: boolean }> {
    return this.request({ kind: 'save-authority' }) as Promise<{
      savedChunks: string[];
      gameplaySaved: boolean;
    }>;
  }

  commitFluid(candidate: FluidCandidate): void {
    this.post({ kind: 'fluid-candidate', protocolVersion: PROTOCOL_VERSION, epoch: this.epoch, candidate });
  }

  failFluid(workId: string, reason: string): void {
    this.post({ kind: 'fluid-failure', protocolVersion: PROTOCOL_VERSION, epoch: this.epoch, workId, reason });
  }

  sendLogicIntents(observationSequence: number, intents: readonly LogicIntent[]): void {
    this.post({
      kind: 'logic-intents',
      protocolVersion: PROTOCOL_VERSION,
      epoch: this.epoch,
      observationSequence,
      intents,
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
  }

  private request(payload: Record<string, unknown>): Promise<unknown> {
    const requestId = ++this.requestSequence;
    const promise = new Promise((resolve, reject) => this.pending.set(requestId, { resolve, reject }));
    this.post({ ...payload, protocolVersion: PROTOCOL_VERSION, epoch: this.epoch, requestId } as AuthorityRequest);
    return promise;
  }

  private post(message: AuthorityRequest): void {
    if (this.disposed) return;
    this.worker.postMessage(message);
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
      case 'authority-snapshot':
        this.snapshotValue = message.snapshot;
        if (message.gameplay) this.updateGameplay(message.gameplay);
        message.commits?.forEach((commit) => this.options.onCommit?.(commit));
        this.options.onSnapshot?.(message.snapshot);
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
        this.meshCache.set(payload.key, {
          payload,
          canonical: new Uint16Array(payload.canonical),
          halo: new Uint16Array(payload.halo),
          fluid: new Uint8Array(payload.fluid),
          fluidHalo: new Uint8Array(payload.fluidHalo),
        });
        pending.resolve(undefined);
        break;
      }
      case 'fluid-work':
        this.options.onFluidWork?.(message.snapshot);
        break;
      case 'logic-observation':
        this.options.onLogicObservation?.(message.observationSequence, message.snapshot);
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
