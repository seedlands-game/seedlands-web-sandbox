import { MessageChannel, Worker, type MessagePort } from 'node:worker_threads';
import type { AuthorityAction } from '../../worker/authority-worker-protocol';
import type { AuthoritySnapshot } from '../../server/authority/authority-session';
import type { AuthorityTransactionReceipt } from '../../server/authority/authority-runtime-types';
import type { DedicatedHostOptions, DedicatedPublication } from '../../server/dedicated/dedicated-host-types';
import type { AuthorityCollisionBaselineResult } from '../../server/game-server-types';
import type { InputCommand, SequenceDecision } from '../../runtime/session-protocol';
import type { NodeComputeExecutorEntryPoints } from '../compute/node-compute-executor';
import type { NodeDedicatedComputeLimits, NodeDedicatedStopResult } from './node-dedicated-runtime-types';
import {
  createNodeRpcClient,
  NodeRpcClosedError,
  type NodeRpcDiagnostics,
  type NodeRpcLimits,
} from './node-rpc-contract';
import {
  validateAuthorityPublicationMessage,
  validateAuthorityRequestPayload,
  validateAuthorityResponsePayload,
} from './node-authority-lane-protocol';
import type { NodePersistenceProxyBootstrap } from '../persistence/persistence-lane-proxy';

export type NodeAuthorityLaneOptions = Readonly<{
  entry: URL;
  epoch: string;
  seedText: string;
  generatorVersion: number;
  worldId?: string;
  persistencePort: MessagePort;
  persistenceProxy: NodePersistenceProxyBootstrap;
  controlRpcLimits?: NodeRpcLimits;
  computeMode: 'inline' | 'worker-thread' | 'child-process';
  computeEntries: NodeComputeExecutorEntryPoints;
  computeLimits?: Partial<NodeDedicatedComputeLimits>;
  hostLimits?: DedicatedHostOptions['limits'];
  wakeIntervalMs?: number;
  publicationAckTimeoutMs?: number;
  startTimeoutMs?: number;
}>;

export type NodeAuthorityDiagnostics = Readonly<{
  state: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
  epoch: string;
  wakeCount: number;
  failure: string | null;
  host: ReturnType<import('../../server/dedicated/dedicated-server-host').DedicatedServerHost['diagnostics']>;
  compute: Readonly<{ general: unknown; fluid: unknown; logic: unknown }>;
}>;

export type NodeAuthorityPublication = DedicatedPublication & Readonly<{ resyncRequired?: true }>;

export type NodeAuthorityLaneDiagnostics = Readonly<{
  state: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
  epoch: string;
  threadId: number;
  latestPublicationSequence: number;
  rpc: NodeRpcDiagnostics;
  failure: string | null;
}>;

export type NodeAuthorityLane = Readonly<{
  threadId: number;
  epoch: string;
  state: () => NodeAuthorityLaneDiagnostics['state'];
  receiveInput(input: InputCommand): Promise<SequenceDecision>;
  performAction(action: AuthorityAction, sequence: number): Promise<AuthorityTransactionReceipt<unknown>>;
  requestChunk(key: string): Promise<boolean>;
  readCollisionBaseline(key: string, minimumRevision: number): Promise<AuthorityCollisionBaselineResult>;
  setInterestRadius(radius: 1 | 2 | 3): Promise<void>;
  requestCheckpoint(): Promise<unknown>;
  waitForIdle(): Promise<void>;
  readDiagnostics(): Promise<NodeAuthorityDiagnostics>;
  latestSnapshot(): Readonly<AuthoritySnapshot> | null;
  latestPublication(): Readonly<NodeAuthorityPublication> | null;
  subscribePublication(listener: (publication: Readonly<NodeAuthorityPublication>) => void): () => void;
  diagnostics(): NodeAuthorityLaneDiagnostics;
  stop(): Promise<NodeDedicatedStopResult>;
  /** 首个逻辑或协议失败立即可见；物理清理仍由 whenExited 跟踪。 */
  whenFailed(): Promise<Error>;
  whenExited(): Promise<NodeDedicatedStopResult>;
  close(): Promise<void>;
}>;

export type NodeAuthorityWorkerBootstrap = Readonly<{
  type: 'bootstrap';
  options: Omit<NodeAuthorityLaneOptions, 'entry' | 'persistencePort' | 'computeEntries'> &
    Readonly<{ computeEntries: Readonly<{ worker: string; child: string }>; controlRpcLimits: NodeRpcLimits }>;
  controlPort: MessagePort;
  publicationPort: MessagePort;
  persistencePort: MessagePort;
}>;

export type NodeAuthorityWorkerFailureRequest = Readonly<{ type: 'fail'; error: string }>;

type ParentMessage =
  | Readonly<{ type: 'ready'; diagnostics: NodeAuthorityDiagnostics }>
  | Readonly<{ type: 'fatal'; error: string }>
  | Readonly<{ type: 'cleanup-complete'; error?: string }>
  | Readonly<{ type: 'stopped'; result: NodeDedicatedStopResult }>;

const DEFAULT_RPC_LIMITS: NodeRpcLimits = Object.freeze({
  maxRequests: 256,
  maxQueuedBytes: 16 * 1_024 * 1_024,
  maxInFlightBytes: 16 * 1_024 * 1_024,
  maxResponseBytes: 4 * 1_024 * 1_024,
  maxReservedResponseBytes: 16 * 1_024 * 1_024,
  maxConcurrentRequests: 8,
});

function asError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(typeof value === 'string' ? value : fallback);
}

function bootstrap(
  options: NodeAuthorityLaneOptions,
  controlPort: MessagePort,
  publicationPort: MessagePort,
): NodeAuthorityWorkerBootstrap {
  const workerOptions = {
    epoch: options.epoch,
    seedText: options.seedText,
    generatorVersion: options.generatorVersion,
    ...(options.worldId ? { worldId: options.worldId } : {}),
    persistenceProxy: options.persistenceProxy,
    computeMode: options.computeMode,
    ...(options.computeLimits ? { computeLimits: options.computeLimits } : {}),
    ...(options.hostLimits ? { hostLimits: options.hostLimits } : {}),
    ...(options.wakeIntervalMs ? { wakeIntervalMs: options.wakeIntervalMs } : {}),
    ...(options.publicationAckTimeoutMs ? { publicationAckTimeoutMs: options.publicationAckTimeoutMs } : {}),
    ...(options.startTimeoutMs ? { startTimeoutMs: options.startTimeoutMs } : {}),
  };
  return {
    type: 'bootstrap',
    options: {
      ...workerOptions,
      computeEntries: { worker: options.computeEntries.worker.href, child: options.computeEntries.child.href },
      controlRpcLimits: options.controlRpcLimits ?? DEFAULT_RPC_LIMITS,
    },
    controlPort,
    publicationPort,
    persistencePort: options.persistencePort,
  };
}

/** Main-thread façade: it caches cloned publications but never exposes a Host or GameServer. */
export async function createNodeAuthorityLane(options: NodeAuthorityLaneOptions): Promise<NodeAuthorityLane> {
  if (!options.epoch.trim() || !options.seedText.trim()) throw new TypeError('Authority lane 身份无效。');
  const control = new MessageChannel();
  const publication = new MessageChannel();
  const worker = new Worker(options.entry);
  const rpc = createNodeRpcClient({
    port: control.port1,
    epoch: options.epoch,
    generation: 0,
    limits: options.controlRpcLimits ?? DEFAULT_RPC_LIMITS,
    validateRequest: validateAuthorityRequestPayload,
    validateResponse: validateAuthorityResponsePayload,
  });
  let currentState: NodeAuthorityLaneDiagnostics['state'] = 'starting';
  let failure: string | null = null;
  let publicationSequence = -1;
  let latest: NodeAuthorityPublication | null = null;
  const listeners = new Set<(value: Readonly<NodeAuthorityPublication>) => void>();
  let stopped: NodeDedicatedStopResult | null = null;
  let stopRequest: Promise<NodeDedicatedStopResult> | null = null;
  let closeRequest: Promise<void> | null = null;
  let closingRequested = false;
  let failedStopRequest: Promise<NodeDedicatedStopResult> | null = null;
  let resolveExit!: (result: NodeDedicatedStopResult) => void;
  let rejectExit!: (error: Error) => void;
  const exited = new Promise<NodeDedicatedStopResult>((resolve, reject) => {
    resolveExit = resolve;
    rejectExit = reject;
  });
  void exited.catch(() => undefined);
  let rejectReady!: (error: Error) => void;
  let readyTimer: ReturnType<typeof setTimeout> | null = null;
  let readySettled = false;
  const failReady = (error: Error) => {
    if (readySettled) return;
    readySettled = true;
    if (readyTimer) clearTimeout(readyTimer);
    rejectReady(error);
  };
  let resolveFailure!: (error: Error) => void;
  let failureSettled = false;
  const failed = new Promise<Error>((resolve) => {
    resolveFailure = resolve;
  });
  let resolveCleanup!: () => void;
  let rejectCleanup!: (error: Error) => void;
  let cleanupSettled = false;
  const cleanup = new Promise<void>((resolve, reject) => {
    resolveCleanup = resolve;
    rejectCleanup = reject;
  });
  void cleanup.catch(() => undefined);
  const settleCleanup = (error?: Error) => {
    if (cleanupSettled) return;
    cleanupSettled = true;
    if (error) rejectCleanup(error);
    else resolveCleanup();
  };
  const requestWorkerFailure = (error: Error) => {
    if (closingRequested) return;
    try {
      const request: NodeAuthorityWorkerFailureRequest = { type: 'fail', error: error.message };
      worker.postMessage(request);
    } catch {
      // Worker 的 error/exit 监听会记录实际物理终态；不能在此抢先 terminate 正常清理。
    }
  };
  const markFailed = (error: Error, requestCleanup = false) => {
    if (!failure) failure = error.message;
    currentState = 'failed';
    if (!failureSettled) {
      failureSettled = true;
      resolveFailure(error);
    }
    failReady(error);
    if (requestCleanup) requestWorkerFailure(error);
  };
  const onPublication = (value: unknown) => {
    try {
      const message = validateAuthorityPublicationMessage(value, options.epoch);
      if (message.sequence <= publicationSequence) return;
      publicationSequence = message.sequence;
      latest = structuredClone(message.publication);
      publication.port1.postMessage({ type: 'publication-ack', epoch: options.epoch, sequence: publicationSequence });
      for (const listener of listeners) listener(structuredClone(latest));
    } catch (error) {
      const failureError = asError(error, 'Authority publication 无效。');
      rpc.close(failureError);
      markFailed(failureError, true);
    }
  };
  const onPublicationFailure = (error?: unknown) => {
    if (closingRequested || stopped) return;
    const failureError = asError(error, 'Authority publication port failed.');
    rpc.close(failureError);
    markFailed(failureError, true);
  };
  publication.port1.on('message', onPublication);
  publication.port1.on('close', onPublicationFailure);
  publication.port1.on('messageerror', onPublicationFailure);
  const ready = new Promise<void>((resolve, reject) => {
    rejectReady = reject;
    const timeoutMs = options.startTimeoutMs ?? 30_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      reject(new RangeError('Authority lane startTimeoutMs 无效。'));
      return;
    }
    readyTimer = setTimeout(() => failReady(new Error('Authority lane 启动超时。')), timeoutMs);
    worker.on('message', (raw: ParentMessage) => {
      if (raw.type === 'ready') {
        if (readySettled) return;
        readySettled = true;
        if (readyTimer) clearTimeout(readyTimer);
        currentState = 'running';
        resolve();
      } else if (raw.type === 'stopped') {
        stopped = raw.result;
        if (!failure) currentState = 'stopped';
      } else if (raw.type === 'fatal') {
        const failureError = new Error(raw.error);
        rpc.close(failureError);
        markFailed(failureError);
      } else if (raw.type === 'cleanup-complete') {
        const cleanupError = raw.error ? new Error(raw.error) : undefined;
        if (cleanupError) markFailed(cleanupError);
        settleCleanup(cleanupError);
      }
    });
  });
  worker.once('error', (error) => {
    const failureError = asError(error, 'Authority worker failed.');
    // Worker error 已是物理故障；不能再假定仍可经 parentPort 请求有序清理。
    markFailed(failureError);
  });
  worker.once('exit', (code) => {
    publication.port1.off('message', onPublication);
    publication.port1.off('close', onPublicationFailure);
    publication.port1.off('messageerror', onPublicationFailure);
    rpc.close(new Error(`Authority worker exited (${code}).`));
    settleCleanup();
    if (closingRequested && stopped && !failure) resolveExit(stopped);
    else {
      const error = new Error(failure ?? `Authority worker exited unexpectedly (${code}).`);
      markFailed(error);
      rejectExit(error);
    }
  });
  void rpc.whenClosed().then((terminal) => {
    if (terminal.cause !== 'local-close') markFailed(terminal.error, true);
  });
  worker.postMessage(bootstrap(options, control.port2, publication.port2), [
    control.port2,
    publication.port2,
    options.persistencePort,
  ]);
  try {
    await ready;
  } catch (error) {
    rpc.close(asError(error, 'Authority lane 启动失败。'));
    await worker.terminate();
    throw error;
  }

  const request = <T>(kind: string, payload: unknown): Promise<T> => rpc.request(kind, payload) as Promise<T>;
  const waitForFailureCleanup = (): Promise<NodeDedicatedStopResult> => {
    if (!failedStopRequest)
      failedStopRequest = cleanup.then(
        () => Promise.reject(new Error(failure ?? 'Authority worker failed.')),
        (error: unknown) => Promise.reject(asError(error, 'Authority worker cleanup failed.')),
      );
    return failedStopRequest;
  };
  const settleStopError = (value: unknown): Promise<NodeDedicatedStopResult> => {
    if (failure) return waitForFailureCleanup();
    if (!(value instanceof NodeRpcClosedError) || !rpc.diagnostics().closed) throw value;
    return rpc.whenClosed().then((terminal) => {
      if (terminal.cause === 'local-close') throw value;
      // Port close 与被拒绝的请求可在同一事件轮次中到达。此处确保已在途 stop
      // 不会在 terminal 处理器记录失败前先把调用方结算为普通 RPC 错误。
      markFailed(terminal.error, true);
      return waitForFailureCleanup();
    });
  };
  const collisionBaselineFailure = (message: string): never => {
    const error = new Error(message);
    rpc.close(error);
    markFailed(error, true);
    throw error;
  };
  return {
    get threadId() {
      return worker.threadId;
    },
    epoch: options.epoch,
    state: () => currentState,
    receiveInput: (input) => request('authority-receive-input', { input }),
    performAction: (action, sequence) => request('authority-perform-action', { action, sequence }),
    requestChunk: (key) => request('authority-request-chunk', { key }),
    readCollisionBaseline: async (key, minimumRevision) => {
      const result = await request<AuthorityCollisionBaselineResult>('authority-read-collision-baseline', {
        key,
        minimumRevision,
      });
      if (result.key !== key)
        return collisionBaselineFailure('Authority collision baseline response key does not match request.');
      if (result.status === 'unavailable') return { status: 'unavailable', key: result.key };
      if (result.chunkRevision < minimumRevision)
        return collisionBaselineFailure('Authority collision baseline response revision is older than requested.');
      return {
        status: 'available',
        key: result.key,
        chunkRevision: result.chunkRevision,
        canonical: result.canonical.slice(0),
        fluid: result.fluid.slice(0),
      };
    },
    setInterestRadius: async (radius) => {
      await request('authority-set-interest-radius', { radius });
    },
    requestCheckpoint: () => request('authority-request-checkpoint', {}),
    waitForIdle: async () => {
      await request('authority-wait-for-idle', {});
    },
    readDiagnostics: () => request('authority-read-diagnostics', {}),
    latestSnapshot: () => (latest ? structuredClone(latest.snapshot) : null),
    latestPublication: () => (latest ? structuredClone(latest) : null),
    subscribePublication: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    diagnostics: () => ({
      state: currentState,
      epoch: options.epoch,
      threadId: worker.threadId,
      latestPublicationSequence: publicationSequence,
      rpc: rpc.diagnostics(),
      failure,
    }),
    stop: () => {
      if (failure) return waitForFailureCleanup();
      if (!stopRequest) {
        currentState = 'stopping';
        stopRequest = request<NodeDedicatedStopResult>('authority-stop', {}).then(
          (result) => {
            stopped = result;
            if (failure) return waitForFailureCleanup();
            currentState = 'stopped';
            return result;
          },
          (error: unknown) => {
            return settleStopError(error);
          },
        );
      }
      return stopRequest;
    },
    whenFailed: () => failed,
    whenExited: () => exited,
    close: () => {
      if (!closeRequest) {
        closingRequested = true;
        closeRequest = (async () => {
          rpc.close();
          publication.port1.close();
          await worker.terminate();
          await exited;
        })();
      }
      return closeRequest;
    },
  };
}
