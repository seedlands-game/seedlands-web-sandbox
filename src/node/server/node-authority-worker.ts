import { parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { DedicatedServerHost } from '../../server/dedicated/dedicated-server-host';
import type { DedicatedPublication } from '../../server/dedicated/dedicated-host-types';
import { createNodeComputeExecutor, type NodeComputeExecutorEntryPoints } from '../compute/node-compute-executor';
import { createNodePersistenceLaneProxy, type NodePersistenceLaneProxy } from '../persistence/persistence-lane-proxy';
import { attachNodeRpcServer, type NodeRpcServer } from '../runtime/node-rpc-contract';
import {
  validateAuthorityPublicationAck,
  validateAuthorityPublicationMessage,
  validateAuthorityRequestPayload,
  validateAuthorityResponsePayload,
  type AuthorityPublicationMessage,
} from '../runtime/node-authority-lane-protocol';
import { measureNodeRpcBytes } from '../runtime/node-rpc-bytes';
import type {
  NodeAuthorityDiagnostics,
  NodeAuthorityPublication,
  NodeAuthorityWorkerFailureRequest,
  NodeAuthorityWorkerBootstrap,
} from '../runtime/node-authority-lane';

if (!parentPort) throw new Error('Authority Worker 缺少 parentPort。');
const parent = parentPort;

const DEFAULT_COMPUTE_LIMITS = {
  maxTasks: 256,
  maxBytes: 16 * 1_024 * 1_024,
  maxResultBytes: 4 * 1_024 * 1_024,
  poolSize: 1,
};
const MAX_RETAINED_COMMITS = 512;
const MAX_RETAINED_COMMIT_BYTES = 4 * 1_024 * 1_024;
const DEFAULT_PUBLICATION_ACK_TIMEOUT_MS = 5_000;

type AuthorityWorker = Readonly<{
  host: DedicatedServerHost;
  rpc: NodeRpcServer;
  persistence: NodePersistenceLaneProxy;
  stop(): Promise<{ status: 'stopped'; durableCommitSequence: number }>;
  fail(error: unknown): void;
  diagnostics(): NodeAuthorityDiagnostics;
}>;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} 无效。`);
  return value as Record<string, unknown>;
}

function entries(value: Readonly<{ worker: string; child: string }>): NodeComputeExecutorEntryPoints {
  return { worker: new URL(value.worker), child: new URL(value.child) };
}

async function start(bootstrap: NodeAuthorityWorkerBootstrap): Promise<AuthorityWorker> {
  const { options } = bootstrap;
  const persistence = await createNodePersistenceLaneProxy({
    port: bootstrap.persistencePort,
    epoch: options.epoch,
    bootstrap: options.persistenceProxy,
  });
  const computeLimits = { ...DEFAULT_COMPUTE_LIMITS, ...options.computeLimits };
  const createExecutor = () =>
    createNodeComputeExecutor({
      mode: options.computeMode,
      maxTasks: computeLimits.maxTasks,
      maxBytes: computeLimits.maxBytes,
      maxResultBytes: computeLimits.maxResultBytes,
      poolSize: computeLimits.poolSize,
      expectedEpoch: options.epoch,
      entries: entries(options.computeEntries),
    });
  const executors = { general: createExecutor(), fluid: createExecutor(), logic: createExecutor() };
  let host: DedicatedServerHost;
  try {
    host = await DedicatedServerHost.create({
      epoch: options.epoch,
      seedText: options.seedText,
      generatorVersion: options.generatorVersion,
      ...(options.worldId ? { worldId: options.worldId } : {}),
      persistence,
      executors,
      now: () => performance.now(),
      ...(options.hostLimits ? { limits: options.hostLimits } : {}),
    });
  } catch (error) {
    await Promise.allSettled([...new Set(Object.values(executors))].map((executor) => executor.close()));
    await persistence.close();
    throw error;
  }
  let wakeCount = 0;
  let failure: Error | null = null;
  let stopped: Promise<{ status: 'stopped'; durableCommitSequence: number }> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let nextPublication = 0;
  let awaitingPublication: number | null = null;
  let latestPublication: DedicatedPublication | null = null;
  let retainedCommits: DedicatedPublication['commits'] = [];
  let retainedCommitBytes = 0;
  let resyncRequired = false;
  const publicationAckTimeoutMs = options.publicationAckTimeoutMs ?? DEFAULT_PUBLICATION_ACK_TIMEOUT_MS;
  if (!Number.isSafeInteger(publicationAckTimeoutMs) || publicationAckTimeoutMs < 1)
    throw new RangeError('Authority publicationAckTimeoutMs 无效。');
  let publicationAckTimer: ReturnType<typeof setTimeout> | null = null;
  const clearPublicationAck = () => {
    if (publicationAckTimer) clearTimeout(publicationAckTimer);
    publicationAckTimer = null;
  };

  const emitPublication = () => {
    if (awaitingPublication !== null || !latestPublication) return;
    const sequence = nextPublication++;
    const publication: NodeAuthorityPublication = {
      ...latestPublication,
      commits: resyncRequired ? [] : retainedCommits,
      ...(resyncRequired ? { resyncRequired: true } : {}),
    };
    latestPublication = null;
    retainedCommits = [];
    retainedCommitBytes = 0;
    resyncRequired = false;
    awaitingPublication = sequence;
    try {
      const message: AuthorityPublicationMessage = {
        type: 'publication',
        epoch: options.epoch,
        sequence,
        publication,
      };
      validateAuthorityPublicationMessage(message, options.epoch);
      bootstrap.publicationPort.postMessage(message);
      publicationAckTimer = setTimeout(
        () => fail(new Error(`Authority publication ${sequence} acknowledgement timed out.`)),
        publicationAckTimeoutMs,
      );
    } catch (error) {
      fail(error);
    }
  };
  const unsubscribe = host.subscribe((publication) => {
    const commitBytes = measureNodeRpcBytes(publication.commits);
    if (
      retainedCommits.length + publication.commits.length > MAX_RETAINED_COMMITS ||
      retainedCommitBytes + commitBytes > MAX_RETAINED_COMMIT_BYTES
    ) {
      retainedCommits = [];
      retainedCommitBytes = 0;
      resyncRequired = true;
    } else {
      retainedCommits = [...retainedCommits, ...publication.commits];
      retainedCommitBytes += commitBytes;
    }
    latestPublication = { ...publication, commits: [] };
    emitPublication();
  });
  bootstrap.publicationPort.on('message', (value: unknown) => {
    const ack = validateAuthorityPublicationAck(value, options.epoch);
    if (!ack || ack.sequence !== awaitingPublication) return;
    clearPublicationAck();
    awaitingPublication = null;
    emitPublication();
  });
  bootstrap.publicationPort.on('close', () => {
    if (!stopped) fail(new Error('Authority publication port closed.'));
  });
  bootstrap.publicationPort.on('messageerror', () => fail(new Error('Authority publication port failed.')));
  let failureCleanup: Promise<void> | null = null;
  const cleanupFailure = () => {
    if (failureCleanup) return failureCleanup;
    failureCleanup = (async () => {
      let cleanupError: Error | undefined;
      try {
        await host.stop();
      } catch (error) {
        cleanupError = error instanceof Error ? error : new Error(String(error));
      }
      try {
        await rpc.whenIdle();
      } catch (error) {
        cleanupError ??= error instanceof Error ? error : new Error(String(error));
      }
      parent.postMessage({ type: 'cleanup-complete', ...(cleanupError ? { error: cleanupError.message } : {}) });
    })();
    return failureCleanup;
  };
  const fail = (error: unknown) => {
    if (failure) return;
    failure = error instanceof Error ? error : new Error(String(error));
    if (timer) clearInterval(timer);
    timer = null;
    clearPublicationAck();
    unsubscribe();
    parent.postMessage({ type: 'fatal', error: failure.message });
    rpc.close(failure);
    void cleanupFailure().catch((cleanupError: unknown) =>
      parent.postMessage({
        type: 'cleanup-complete',
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      }),
    );
  };
  const stop = (): Promise<{ status: 'stopped'; durableCommitSequence: number }> => {
    if (!stopped) {
      if (timer) clearInterval(timer);
      timer = null;
      clearPublicationAck();
      stopped = host
        .stop()
        .then(() => {
          unsubscribe();
          const result = {
            status: 'stopped' as const,
            durableCommitSequence: host.diagnostics().durableCommitSequence,
          };
          parent.postMessage({ type: 'stopped', result });
          return result;
        })
        .catch((error: unknown) => {
          fail(error);
          throw error;
        });
    }
    return stopped;
  };
  const rpc = attachNodeRpcServer({
    port: bootstrap.controlPort,
    epoch: options.epoch,
    generation: 0,
    limits: options.controlRpcLimits,
    validateRequest: validateAuthorityRequestPayload,
    validateResponse: validateAuthorityResponsePayload,
    handle: async ({ kind, payload }) => {
      const request = object(payload, 'Authority RPC 请求');
      if (kind === 'authority-receive-input') return { payload: host.receiveInput(request.input as never) };
      if (kind === 'authority-perform-action') {
        if (!Number.isSafeInteger(request.sequence)) throw new TypeError('Authority action sequence 无效。');
        return { payload: await host.performAction(request.action as never, request.sequence as number) };
      }
      if (kind === 'authority-request-chunk') {
        if (typeof request.key !== 'string') throw new TypeError('Authority Chunk key 无效。');
        return { payload: await host.requestChunk(request.key) };
      }
      if (kind === 'authority-read-collision-baseline') {
        if (typeof request.key !== 'string' || !Number.isSafeInteger(request.minimumRevision))
          throw new TypeError('Authority collision baseline 请求无效。');
        return { payload: host.runtime.readCollisionBaseline(request.key, request.minimumRevision as number) };
      }
      if (kind === 'authority-set-interest-radius') {
        if (request.radius !== 1 && request.radius !== 2 && request.radius !== 3)
          throw new TypeError('Authority 半径无效。');
        host.setInterestRadius(request.radius);
        return { payload: {} };
      }
      if (kind === 'authority-request-checkpoint') return { payload: await host.save() };
      if (kind === 'authority-wait-for-idle') {
        await host.waitForIdle();
        return { payload: {} };
      }
      if (kind === 'authority-read-diagnostics') return { payload: diagnostics() };
      if (kind === 'authority-stop') return { payload: await stop() };
      throw new TypeError(`Authority RPC 不支持：${kind}`);
    },
  });
  bootstrap.controlPort.on('close', () => {
    if (!stopped) fail(new Error('Authority control port closed.'));
  });
  bootstrap.controlPort.on('messageerror', () => fail(new Error('Authority control port failed.')));
  const diagnostics = (): NodeAuthorityDiagnostics => ({
    state: failure ? 'failed' : stopped ? 'stopped' : 'running',
    epoch: options.epoch,
    wakeCount,
    failure: failure?.message ?? null,
    host: host.diagnostics(),
    compute: {
      general: executors.general.diagnostics(),
      fluid: executors.fluid.diagnostics(),
      logic: executors.logic.diagnostics(),
    },
  });
  timer = setInterval(() => {
    try {
      host.wake(performance.now());
      wakeCount += 1;
      if (host.state === 'failed') throw new Error(host.diagnostics().failure ?? 'Authority host failed.');
    } catch (error) {
      fail(error);
    }
  }, options.wakeIntervalMs ?? 8);
  return { host, rpc, persistence, stop, fail, diagnostics };
}

parent.once('message', (raw: unknown) => {
  const bootstrap = raw as Partial<NodeAuthorityWorkerBootstrap>;
  if (
    bootstrap?.type !== 'bootstrap' ||
    !bootstrap.options ||
    !bootstrap.controlPort ||
    !bootstrap.publicationPort ||
    !bootstrap.persistencePort
  )
    throw new TypeError('Authority Worker bootstrap 无效。');
  void start(bootstrap as NodeAuthorityWorkerBootstrap)
    .then((worker) => {
      parent.on('message', (control: unknown) => {
        const request = control as Partial<NodeAuthorityWorkerFailureRequest>;
        if (request?.type === 'fail' && typeof request.error === 'string' && request.error) worker.fail(request.error);
      });
      parent.postMessage({ type: 'ready', diagnostics: worker.diagnostics() });
    })
    .catch((error: unknown) =>
      parent.postMessage({ type: 'fatal', error: error instanceof Error ? error.message : String(error) }),
    );
});
