import { MessageChannel, Worker, type MessagePort } from 'node:worker_threads';
import {
  assertNodeRpcIdentity,
  assertNodeRpcLimits,
  type NodeRpcDiagnostics,
  type NodeRpcLimits,
} from '../runtime/node-rpc-contract';
import { DEFAULT_PERSISTENCE_LANE_CACHE_LIMITS, type PersistenceLaneCacheLimits } from './persistence-lane-protocol';
import type { NodePersistenceProxyBootstrap } from './persistence-lane-proxy';
import {
  isPersistenceWorkerControlEvent,
  type NodePersistenceStoreOptions,
  type PersistenceWorkerBootstrap,
  type PersistenceWorkerControlRequest,
} from './persistence-worker-control';

export const DEFAULT_PERSISTENCE_RPC_LIMITS: NodeRpcLimits = Object.freeze({
  maxRequests: 32,
  maxQueuedBytes: 512 * 1_024 * 1_024,
  maxInFlightBytes: 256 * 1_024 * 1_024,
  maxResponseBytes: 96 * 1_024 * 1_024,
  maxReservedResponseBytes: 192 * 1_024 * 1_024,
  maxConcurrentRequests: 2,
});

export type NodePersistenceLaneState = 'starting' | 'ready' | 'closing' | 'closed' | 'failed';

export type NodePersistenceLaneOptions = Readonly<{
  entry?: URL;
  epoch: string;
  generation?: number;
  store: NodePersistenceStoreOptions;
  rpcLimits?: Partial<NodeRpcLimits>;
  cacheLimits?: Partial<PersistenceLaneCacheLimits>;
  startupTimeoutMs?: number;
}>;

export type NodePersistenceLane = Readonly<{
  authorityPort: MessagePort;
  threadId: number;
  proxy: NodePersistenceProxyBootstrap;
  readonly state: NodePersistenceLaneState;
  diagnostics(): Readonly<{
    state: NodePersistenceLaneState;
    threadId: number;
    rpc: NodeRpcDiagnostics | null;
    error: string | null;
  }>;
  whenExited(): Promise<void>;
  close(): Promise<void>;
}>;

function validateOptions(options: NodePersistenceLaneOptions) {
  const generation = options.generation ?? 1;
  assertNodeRpcIdentity(options.epoch, generation);
  if ((options.store as NodePersistenceStoreOptions & { faultInjector?: unknown }).faultInjector !== undefined)
    throw new TypeError('Persistence Worker 不接受不可克隆的 faultInjector。');
  const rpcLimits = { ...DEFAULT_PERSISTENCE_RPC_LIMITS, ...options.rpcLimits };
  assertNodeRpcLimits(rpcLimits);
  const cacheLimits = { ...DEFAULT_PERSISTENCE_LANE_CACHE_LIMITS, ...options.cacheLimits };
  for (const [name, value] of Object.entries(cacheLimits))
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Persistence lane 限制 ${name} 无效。`);
  const startupTimeoutMs = options.startupTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 1)
    throw new TypeError('Persistence Worker startupTimeoutMs 无效。');
  const identity = {
    worldId: options.store.worldId ?? 'default',
    seedText: options.store.seedText,
    generatorVersion: options.store.generatorVersion,
  };
  return { generation, rpcLimits, cacheLimits, startupTimeoutMs, identity };
}

export async function createNodePersistenceLane(options: NodePersistenceLaneOptions): Promise<NodePersistenceLane> {
  const validated = validateOptions(options);
  const channel = new MessageChannel();
  const bootstrap: PersistenceWorkerBootstrap = {
    type: 'persistence-worker-bootstrap',
    epoch: options.epoch,
    generation: validated.generation,
    port: channel.port2,
    store: options.store,
    rpcLimits: validated.rpcLimits,
  };
  const worker = new Worker(options.entry ?? new URL('./node-persistence-worker.js', import.meta.url), {
    workerData: bootstrap,
    transferList: [channel.port2],
  });
  let state: NodePersistenceLaneState = 'starting';
  let rpcDiagnostics: NodeRpcDiagnostics | null = null;
  let failure: Error | null = null;
  let storeClosed = false;
  let closePromise: Promise<void> | null = null;
  let storeCloseSettled = false;
  let resolveStoreClose!: () => void;
  let rejectStoreClose!: (error: Error) => void;
  const storeCloseCompletion = new Promise<void>((resolve, reject) => {
    resolveStoreClose = resolve;
    rejectStoreClose = reject;
  });
  void storeCloseCompletion.catch(() => undefined);
  const completeStoreClose = () => {
    if (storeCloseSettled) return;
    storeCloseSettled = true;
    resolveStoreClose();
  };
  const failStoreClose = (error: Error) => {
    if (storeCloseSettled) return;
    storeCloseSettled = true;
    rejectStoreClose(error);
  };
  let resolveExit!: () => void;
  let rejectExit!: (error: Error) => void;
  const exited = new Promise<void>((resolve, reject) => {
    resolveExit = resolve;
    rejectExit = reject;
  });
  void exited.catch(() => undefined);

  const startup = new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Persistence Worker 在 ${validated.startupTimeoutMs}ms 内未 ready。`)),
      validated.startupTimeoutMs,
    );
    worker.on('message', (value: unknown) => {
      if (!isPersistenceWorkerControlEvent(value)) return;
      if (value.epoch !== options.epoch || value.generation !== validated.generation) return;
      if (value.type === 'persistence-worker-ready') {
        clearTimeout(timeout);
        if (
          value.threadId !== worker.threadId ||
          value.identity.worldId !== validated.identity.worldId ||
          value.identity.seedText !== validated.identity.seedText ||
          value.identity.generatorVersion !== validated.identity.generatorVersion
        ) {
          reject(new Error('Persistence Worker ready 身份不匹配。'));
          return;
        }
        rpcDiagnostics = value.rpc;
        state = 'ready';
        resolve(value.threadId);
      } else if (value.type === 'persistence-worker-store-closed') {
        storeClosed = true;
        rpcDiagnostics = value.rpc;
        completeStoreClose();
      } else {
        clearTimeout(timeout);
        failure = new Error(value.error);
        state = 'failed';
        failStoreClose(failure);
        reject(failure);
      }
    });
    worker.once('error', (error) => {
      clearTimeout(timeout);
      failure = error instanceof Error ? error : new Error(String(error));
      state = 'failed';
      failStoreClose(failure);
      reject(failure);
    });
  });

  worker.once('exit', (code) => {
    channel.port1.close();
    if ((state === 'closing' || state === 'closed') && storeClosed) {
      state = 'closed';
      resolveExit();
      return;
    }
    const error = failure ?? new Error(`Persistence Worker 意外退出，code=${code}。`);
    failure = error;
    state = 'failed';
    failStoreClose(error);
    rejectExit(error);
  });

  let readyThreadId: number;
  try {
    readyThreadId = await startup;
  } catch (error) {
    channel.port1.close();
    await worker.terminate();
    throw error;
  }

  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    if (failure) {
      const knownFailure = failure;
      closePromise = exited.catch(() => undefined).then(() => Promise.reject(knownFailure));
      return closePromise;
    }
    state = 'closing';
    closePromise = (async () => {
      try {
        if (!storeClosed) {
          const request: PersistenceWorkerControlRequest = {
            type: 'persistence-worker-close',
            epoch: options.epoch,
            generation: validated.generation,
          };
          worker.postMessage(request);
          await storeCloseCompletion;
        }
        await worker.terminate();
        await exited;
      } catch (error) {
        const closeFailure = failure ?? (error instanceof Error ? error : new Error(String(error)));
        await exited.catch(() => undefined);
        throw closeFailure;
      }
    })();
    return closePromise;
  };

  return {
    authorityPort: channel.port1,
    threadId: readyThreadId,
    proxy: {
      identity: validated.identity,
      limits: validated.cacheLimits,
      rpcLimits: validated.rpcLimits,
      generation: validated.generation,
    },
    get state() {
      return state;
    },
    diagnostics: () => ({
      state,
      threadId: readyThreadId,
      rpc: rpcDiagnostics ? { ...rpcDiagnostics } : null,
      error: failure?.message ?? null,
    }),
    whenExited: () => exited,
    close,
  };
}
