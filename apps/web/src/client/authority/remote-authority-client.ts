import type {
  AuthorityAction,
  AuthorityActionResult,
  AuthorityGameplayView,
  AuthorityPlayerPositionResult,
  AuthorityReady,
} from '@seedlands/game-core/compute/authority-worker-protocol';
import type { AuthoritySnapshot } from '@seedlands/game-core/server/authority/authority-session';
import type { WorldCommitResult } from '@seedlands/game-core/server/game-server-types';
import type { InputCommand, SequenceDecision, SessionEpoch } from '@seedlands/game-core/runtime/session-protocol';
import { decodeC0Envelope, encodeC0Envelope } from '@seedlands/game-core/server/protocol/network-c0-codec';
import {
  NETWORK_DRAFT_PROTOCOL_VERSION,
  type NetworkMessageClass,
  type PlayablePublicOutboundMessage,
  type PublicInboundMessage,
  type PublicSessionRef,
} from '@seedlands/game-core/server/protocol/network-message-semantics';
import type { GameplayConsumerReference } from '@seedlands/game-core/server/protocol/network-gameplay-consumer-reference';
import type { PlayerCorrectionReference } from '@seedlands/game-core/server/protocol/network-reference-projection';
import type { WorldCommitPresentationReference } from '@seedlands/game-core/server/protocol/network-reference-world-commit-presentation';
import type { ActionReceiptReference } from '@seedlands/game-core/server/protocol/network-action-reference';
import { RemoteAuthorityMeshMirror } from './remote-authority-mesh-mirror';
import type { AuthorityClientOptions, AuthoritySaveResult } from './browser-authority-client-contract';
import { projectRemoteInput, RemoteAuthorityInputPipeline } from './remote-authority-input-pipeline';
import {
  commitFromReference,
  gameplayFromReference,
  integer,
  parseLocalPlayableUrl,
  projectRemoteWelcome,
  sameRef,
  snapshotFromCorrection,
} from './remote-authority-projections';

const utf8 = {
  encode: (value: string) => new TextEncoder().encode(value),
  decodeFatal: (value: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(value),
};
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PENDING_REQUESTS = 64;
const MAX_SOCKET_BUFFERED_BYTES = 4 * 1024 * 1024;
const PLAYABLE_REJECTION = '远端模式不开放浏览器管理权威世界。';

type Pending<T> = { resolve(value: T): void; reject(error: Error): void; timer: number };
export type RemoteAuthorityConnectOptions = AuthorityClientOptions &
  Readonly<{ url: string; accessKey: string; signal?: AbortSignal }>;

export class RemoteAuthorityClient {
  readonly mode = 'remote' as const;
  readonly meshInputMode = 'authority-complete' as const;
  private ref: PublicSessionRef | null = null;
  private serverEpoch = '';
  private readyValue: AuthorityReady | null = null;
  private snapshotValue: AuthoritySnapshot | null = null;
  private gameplayValue: AuthorityGameplayView | null = null;
  private publicationSequence = -1;
  private consumedCommitWorldRevision = 0;
  private requestSequence = 0;
  private edgeSequence = 0;
  private snapshotReceivedAtMs = 0;
  private storageBytesValue = 0;
  private readonly inputPipeline = new RemoteAuthorityInputPipeline();
  private disposed = false;
  private failed = false;
  private readonly pendingActions = new Map<number, Pending<AuthorityActionResult>>();
  private readonly pendingBaselines = new Map<number, Pending<void>>();
  private readonly pendingSaves = new Map<number, Pending<AuthoritySaveResult>>();
  private readonly mesh: RemoteAuthorityMeshMirror;
  private heartbeat: number | null = null;

  private constructor(
    private readonly socket: WebSocket,
    readonly epoch: SessionEpoch,
    private readonly options: AuthorityClientOptions,
  ) {
    this.mesh = new RemoteAuthorityMeshMirror({
      nextRequestId: () => ++this.requestSequence,
      createPending: (requestId, timeoutMessage, onTimeout) =>
        this.makePending(this.pendingBaselines, requestId, timeoutMessage, onTimeout),
      resolvePending: (requestId) => this.resolveOne(this.pendingBaselines, requestId, undefined),
      rejectPending: (requestId, error) => this.rejectOne(this.pendingBaselines, requestId, error),
      requestBaseline: (requestId, key) =>
        this.send('interest-update', { kind: 'interest-update', ref: this.requireRef(), requestId, keys: [key] }),
      cancelBaseline: (targetRequestId) => {
        if (this.disposed || this.failed || this.socket.readyState !== WebSocket.OPEN) return;
        this.send('interest-cancel', {
          kind: 'interest-cancel',
          ref: this.requireRef(),
          requestId: ++this.requestSequence,
          targetRequestId,
        });
      },
      onCommit: options.onCommit,
      onUnknownChunk: options.onUnknownChunk,
    });
  }

  static connect(
    connect: RemoteAuthorityConnectOptions,
  ): Promise<{ authority: RemoteAuthorityClient; ready: AuthorityReady }> {
    let url: string;
    try {
      url = parseLocalPlayableUrl(connect.url);
    } catch (error) {
      return Promise.reject(error);
    }
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    const epoch = `remote-browser-${crypto.randomUUID()}` as SessionEpoch;
    const { accessKey, signal, url: _url, ...clientOptions } = connect;
    void _url;
    const authority = new RemoteAuthorityClient(socket, epoch, clientOptions);
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => fail(new Error('连接 Node 超时。')), REQUEST_TIMEOUT_MS);
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        authority.dispose();
        reject(error);
      };
      if (signal?.aborted) return fail(new Error('已取消连接 Node。'));
      signal?.addEventListener('abort', () => fail(new Error('已取消连接 Node。')), { once: true });
      socket.addEventListener(
        'open',
        () => {
          try {
            authority.send('session-hello', {
              kind: 'session-hello',
              protocolVersion: NETWORK_DRAFT_PROTOCOL_VERSION,
              transport: 'experimental-local-c0-v1',
              accessKey,
            });
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
          }
        },
        { once: true },
      );
      socket.addEventListener('message', (event) => {
        void authority
          .receive(event.data)
          .then((ready) => {
            if (!ready || settled) return;
            settled = true;
            clearTimeout(timer);
            authority.installRuntimeListeners();
            resolve({ authority, ready });
          })
          .catch((error) =>
            settled ? authority.fail(error instanceof Error ? error : new Error(String(error))) : fail(error),
          );
      });
      socket.addEventListener('error', () => fail(new Error('无法连接 Node。')), { once: true });
      socket.addEventListener('close', (event) => fail(new Error(`Node 拒绝连接：${event.reason || event.code}`)), {
        once: true,
      });
    });
  }

  // prettier-ignore
  get readyState() { return this.readyValue; }
  // prettier-ignore
  get isReady() { return Boolean(this.readyValue) && !this.disposed && !this.failed; }
  // prettier-ignore
  get snapshot() { return this.snapshotValue; }
  get gameplay() {
    if (!this.gameplayValue) throw new Error('远端 gameplay 尚未同步。');
    return this.gameplayValue;
  }
  // prettier-ignore
  get seed() { return this.requireReady().seed; }
  // prettier-ignore
  get seedText() { return this.requireReady().seedText; }
  // prettier-ignore
  get generatorVersion() { return this.requireReady().generatorVersion; }
  // prettier-ignore
  get worldTime() { return this.snapshotValue?.worldTime ?? this.requireReady().worldTime; }
  // prettier-ignore
  get worldRevision() { return this.snapshotValue?.worldRevision ?? 0; }
  // prettier-ignore
  get mutationCount() { return this.snapshotValue?.worldMutationCount ?? 0; }
  // prettier-ignore
  get physicsTick() { return this.snapshotValue?.physicsTick ?? 0; }
  // prettier-ignore
  get commitSequence() { return this.snapshotValue?.commitSequence ?? 0; }
  // prettier-ignore
  get storageBytes() { return this.storageBytesValue; }
  // prettier-ignore
  get estimatedInputTransitMs() { return 16; }
  // prettier-ignore
  get snapshotRejections() { return { wrongEpoch: 0, stale: 0 }; }
  // prettier-ignore
  get readyBaselines() { return this.mesh.readyOwnerCount; }

  evidenceSnapshot() {
    const snapshot = this.snapshotValue;
    if (!snapshot) throw new Error('Node authority evidence 尚未 ready。');
    return Object.freeze({ clientEpoch: this.epoch, serverEpoch: this.serverEpoch, snapshot });
  }

  sendInput(command: InputCommand): void {
    if (
      !this.ref ||
      command.epoch !== this.epoch ||
      this.disposed ||
      this.failed ||
      this.socket.readyState !== WebSocket.OPEN
    )
      return;
    const frequencies = this.requireReady().frequencies;
    const pending = this.inputPipeline.submit(
      command,
      performance.now(),
      (Math.max(2, Math.ceil(frequencies.physicsHz / 2)) / frequencies.physicsHz) * 1_000,
    );
    if (pending) this.sendProjectedInput(pending);
  }

  private sendProjectedInput(input: Parameters<typeof projectRemoteInput>[0]): void {
    const frequencies = this.requireReady().frequencies;
    const now = performance.now();
    const projected = projectRemoteInput(input, this.requireRef(), {
      now,
      snapshotReceivedAtMs: this.snapshotReceivedAtMs,
      snapshotPhysicsTick: this.snapshotValue?.physicsTick ?? 0,
      physicsHz: frequencies.physicsHz,
    });
    if (projected.edge) this.send('input-edge', { ...projected.edge, edgeId: ++this.edgeSequence });
    this.send('input-state', projected.state);
  }

  ensureChunkNeighborhood(cx: number, cy: number, cz: number): Promise<void> {
    return this.mesh.ensure(cx, cy, cz);
  }
  releasePreparation(_cx: number, _cy: number, _cz: number): void {}
  releaseChunkNeighborhood(cx: number, cy: number, cz: number): void {
    this.mesh.release(cx, cy, cz);
  }
  prepareWorkerInput(cx: number, cy: number, cz: number) {
    const lease = this.mesh.prepareComplete(cx, cy, cz);
    try {
      return { ...lease.input, overlays: lease.input.overlays.map((overlay) => ({ ...overlay })) };
    } finally {
      lease.settle();
    }
  }
  prepareCompleteWorkerInput(cx: number, cy: number, cz: number) {
    return this.mesh.prepareComplete(cx, cy, cz);
  }
  acceptWorkerCanonical(
    task: Parameters<RemoteAuthorityMeshMirror['acceptMesh']>[0],
    result: Parameters<RemoteAuthorityMeshMirror['acceptMesh']>[1],
  ): boolean {
    return this.mesh.acceptMesh(task, result);
  }
  acceptDerivedMesh(
    task: Parameters<RemoteAuthorityMeshMirror['acceptMesh']>[0],
    result: Parameters<RemoteAuthorityMeshMirror['acceptMesh']>[1],
  ): boolean {
    return this.mesh.acceptMesh(task, result);
  }
  getVoxel(x: number, y: number, z: number): number {
    return this.mesh.getVoxel(x, y, z);
  }
  getFluidCell(x: number, y: number, z: number): { level: number; source: boolean } | null {
    return this.mesh.getFluidCell(x, y, z);
  }
  getChunkRevision(cx: number, cy: number, cz: number): number | null {
    return this.mesh.getChunkRevision(cx, cy, cz);
  }
  setFluidActiveChunks(_keys: readonly string[]): void {}

  performAction(action: AuthorityAction): Promise<AuthorityActionResult> {
    const requestId = ++this.requestSequence;
    const pending = this.makePending(this.pendingActions, requestId, '远端动作回执超时。');
    this.send('player-action', {
      kind: 'player-action',
      ref: this.requireRef(),
      requestId,
      action,
    });
    return pending;
  }

  save(): Promise<AuthoritySaveResult> {
    const requestId = ++this.requestSequence;
    const pending = this.makePending(this.pendingSaves, requestId, '等待 Node 保存确认超时。');
    this.send('checkpoint-request', { kind: 'checkpoint-request', ref: this.requireRef(), requestId });
    return pending;
  }

  pause(): Promise<{ paused: true }> {
    return Promise.reject(new Error(PLAYABLE_REJECTION));
  }
  resume(): Promise<{ paused: false }> {
    return Promise.reject(new Error(PLAYABLE_REJECTION));
  }
  editWorld(): Promise<WorldCommitResult> {
    return Promise.reject(new Error(PLAYABLE_REJECTION));
  }
  setPlayerPosition(): Promise<AuthorityPlayerPositionResult> {
    return Promise.reject(new Error(PLAYABLE_REJECTION));
  }
  setWorldTime(): Promise<{ worldTime: number }> {
    return Promise.reject(new Error(PLAYABLE_REJECTION));
  }
  setWorldClockRate(): Promise<{ rate: number }> {
    return Promise.reject(new Error(PLAYABLE_REJECTION));
  }
  executeCommand(): Promise<never> {
    return Promise.reject(new Error(PLAYABLE_REJECTION));
  }
  requestLogicObservation(): void {}

  dispose(): void {
    if (this.disposed) return;
    if (this.ref && this.socket.readyState === WebSocket.OPEN)
      try {
        this.send('disconnect', { kind: 'disconnect', ref: this.ref, reason: 'client-close' });
      } catch {
        /* Socket close below remains the terminal cleanup path. */
      }
    this.disposed = true;
    this.inputPipeline.clear();
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.rejectPending(new Error('远端会话已关闭。'));
    this.mesh.dispose();
    this.socket.close(1000, 'client-close');
  }

  private installRuntimeListeners(): void {
    this.heartbeat = window.setInterval(() => {
      if (!this.ref || this.socket.readyState !== WebSocket.OPEN) return;
      this.send('heartbeat', { kind: 'heartbeat', ref: this.ref, nonce: Date.now() });
    }, 5_000);
    this.socket.addEventListener('close', (event) => {
      if (this.disposed) return;
      this.fail(new Error(`Node 连接已断开：${event.reason || event.code}`));
    });
    this.socket.addEventListener('error', () => this.fail(new Error('Node 连接发生错误。')));
  }

  private async receive(data: unknown): Promise<AuthorityReady | null> {
    if (this.disposed || !(data instanceof ArrayBuffer)) return null;
    const decoded = decodeC0Envelope(new Uint8Array(data), utf8);
    const message = decoded.message as Record<string, unknown>;
    if (!this.ref) return this.acceptWelcome(message);
    const candidateRef = message.ref as PublicSessionRef | undefined;
    if (!candidateRef || !sameRef(candidateRef, this.ref)) throw new Error('Node 消息会话身份不匹配。');
    switch (message.kind) {
      case 'authority-state':
        return this.acceptAuthorityState(
          message as unknown as Extract<PlayablePublicOutboundMessage, { kind: 'authority-state' }>,
        );
      case 'input-decision': {
        const decision = message as unknown as Extract<PlayablePublicOutboundMessage, { kind: 'input-decision' }>;
        const inputDecision = this.inputPipeline.acceptDecision(decision.inputSequence, decision.requiresResync);
        if (!inputDecision.matched) return null;
        this.options.onInputDecision?.({
          sequence: decision.inputSequence,
          decision: decision.decision as SequenceDecision,
          requiresResync: decision.requiresResync,
        });
        if (inputDecision.next && !this.disposed && !this.failed && this.socket.readyState === WebSocket.OPEN)
          this.sendProjectedInput(inputDecision.next);
        return null;
      }
      case 'baseline-descriptor':
        this.mesh.acceptDescriptor(message);
        return null;
      case 'baseline-page':
        await this.mesh.acceptPage(message, decoded.blocks);
        return null;
      case 'baseline-unavailable': {
        this.rejectOne(
          this.pendingBaselines,
          integer(message.requestId, 'requestId'),
          new Error(`Node 无法提供区块：${String(message.reason)}`),
        );
        return null;
      }
      case 'action-receipt':
        return this.acceptActionReceipt(message);
      case 'checkpoint-receipt': {
        const requestId = integer(message.requestId, 'requestId');
        const commitSequence = integer(message.durableCommitSequence, 'durableCommitSequence');
        this.resolveOne(this.pendingSaves, requestId, {
          savedChunks: [],
          gameplaySaved: true,
          commitSequence,
          storageBytes: 0,
        });
        return null;
      }
      case 'resync-required':
        throw new Error('Node 要求重新同步，请手动重新连接。');
      case 'heartbeat-receipt':
        return null;
      default:
        throw new Error(`Node 返回未允许的消息：${String(message.kind)}。`);
    }
  }

  private acceptWelcome(message: Record<string, unknown>): AuthorityReady {
    const projected = projectRemoteWelcome(this.epoch, message);
    this.ref = projected.welcome.ref;
    this.serverEpoch = projected.welcome.serverEpoch;
    this.gameplayValue = projected.gameplay;
    this.snapshotValue = projected.snapshot;
    this.snapshotReceivedAtMs = performance.now();
    this.readyValue = projected.ready;
    this.mesh.initialize(
      projected.interestRef,
      projected.welcome.presentation.limits,
      projected.snapshot.worldRevision,
    );
    this.consumedCommitWorldRevision = projected.snapshot.worldRevision;
    return projected.ready;
  }

  private acceptAuthorityState(message: Extract<PlayablePublicOutboundMessage, { kind: 'authority-state' }>): null {
    if (message.publicationSequence !== this.publicationSequence + 1)
      throw new Error('Node publication 出现序号缺口。');
    this.publicationSequence = message.publicationSequence;
    const correction = message.correction as PlayerCorrectionReference;
    if (correction.epoch !== this.serverEpoch) throw new Error('Node correction epoch 不匹配。');
    const commits = message.commits.map((commit) => commitFromReference(commit as WorldCommitPresentationReference));
    this.consumeCommits(commits);
    if (message.gameplay) {
      this.gameplayValue = gameplayFromReference(message.gameplay as GameplayConsumerReference);
      this.options.onGameplay?.(this.gameplayValue);
    }
    this.snapshotValue = snapshotFromCorrection(this.epoch, correction);
    this.snapshotReceivedAtMs = performance.now();
    this.options.onSnapshot?.(this.snapshotValue);
    return null;
  }

  private acceptActionReceipt(message: Record<string, unknown>): null {
    const requestId = integer(message.requestId, 'requestId');
    const receipt = message.receipt as ActionReceiptReference;
    if (receipt.status !== 'executed') {
      this.rejectOne(this.pendingActions, requestId, new Error(`Node 动作未执行：${receipt.status}。`));
      return null;
    }
    if (message.gameplay) {
      this.gameplayValue = gameplayFromReference(message.gameplay as GameplayConsumerReference);
      this.options.onGameplay?.(this.gameplayValue);
    }
    const commits = Array.isArray(message.commits)
      ? message.commits.map((commit) => commitFromReference(commit as WorldCommitPresentationReference))
      : [];
    this.consumeCommits(commits);
    const outcome = receipt.outcome;
    const result =
      outcome.success && receipt.action.type === 'place'
        ? { success: true, commit: commits.find((commit) => commit.worldRevision === outcome.worldRevision) }
        : outcome;
    this.resolveOne(this.pendingActions, requestId, {
      submittedAction: receipt.action,
      result,
      gameplay: this.gameplay,
      commits,
    });
    return null;
  }

  private send(messageClass: NetworkMessageClass, message: PublicInboundMessage): void {
    if (this.disposed || this.socket.readyState !== WebSocket.OPEN) throw new Error('Node 连接未打开。');
    const encoded = encodeC0Envelope({ messageClass, message, blocks: [] }, utf8);
    if (this.socket.bufferedAmount + encoded.byteLength > MAX_SOCKET_BUFFERED_BYTES) {
      const error = new Error('浏览器发送队列超过本轮远端会话上限。');
      this.fail(error);
      throw error;
    }
    this.socket.send(encoded);
  }

  private consumeCommits(commits: readonly WorldCommitResult[]): void {
    // prettier-ignore
    const fresh = commits.filter((commit) => { if (!commit.committed || commit.worldRevision <= this.consumedCommitWorldRevision) return false; this.consumedCommitWorldRevision = commit.worldRevision; return true; });
    if (fresh.length) this.mesh.consumeCommits(fresh);
  }

  private makePending<T>(
    registry: Map<number, Pending<T>>,
    requestId: number,
    timeoutMessage: string,
    onTimeout?: () => void,
  ): Promise<T> {
    if (this.pendingActions.size + this.pendingBaselines.size + this.pendingSaves.size >= MAX_PENDING_REQUESTS)
      throw new Error('浏览器远端请求队列已满。');
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        registry.delete(requestId);
        onTimeout?.();
        reject(new Error(timeoutMessage));
      }, REQUEST_TIMEOUT_MS);
      registry.set(requestId, { resolve, reject, timer });
    });
  }

  private resolveOne<T>(registry: Map<number, Pending<T>>, requestId: number, value: T): void {
    const pending = registry.get(requestId);
    if (!pending) return;
    registry.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(value);
  }

  private rejectOne<T>(registry: Map<number, Pending<T>>, requestId: number, error: Error): void {
    const pending = registry.get(requestId);
    if (!pending) return;
    registry.delete(requestId);
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  private rejectPending(error: Error): void {
    for (const registry of [this.pendingActions, this.pendingBaselines, this.pendingSaves] as const)
      for (const [requestId] of registry) this.rejectOne(registry as Map<number, Pending<unknown>>, requestId, error);
  }

  private requireRef(): PublicSessionRef {
    if (!this.ref) throw new Error('Node session 尚未建立。');
    return this.ref;
  }
  private requireReady(): AuthorityReady {
    if (!this.readyValue) throw new Error('Node session 尚未 ready。');
    return this.readyValue;
  }
  private fail(error: Error): void {
    if (this.failed || this.disposed) return;
    this.failed = true;
    this.inputPipeline.clear();
    this.rejectPending(error);
    this.options.onFatal?.(error);
    this.dispose();
  }
}
