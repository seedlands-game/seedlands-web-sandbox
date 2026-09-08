import type { Transferable } from 'node:worker_threads';
import type { NodeRpcHandlerResult } from '../runtime/node-rpc-contract';
import { chunkKey } from '@seedlands/game-core/world/voxel';
import type { FileGamePersistence } from './file-game-persistence';
import {
  PERSISTENCE_LANE_PROTOCOL_VERSION,
  type PersistenceEnsureRequest,
  type PersistenceEnsureResult,
  type PersistenceLaneIdentity,
  type PersistenceLaneRequestKind,
  type PersistenceNeighborhoodRequest,
  type PersistenceNeighborhoodResponse,
  type PersistenceOpenRequest,
  type PersistenceOpenResponse,
  type PersistenceSaveRequest,
  type PersistenceSaveResponse,
} from './persistence-lane-protocol';

export type PersistenceLaneHandleRequest = Readonly<{
  kind: string;
  payload: unknown;
  signal: AbortSignal;
}>;

export type PersistenceLaneRequestHandler = Readonly<{
  handle(request: PersistenceLaneHandleRequest): Promise<unknown>;
  handleRpc(request: PersistenceLaneHandleRequest): Promise<NodeRpcHandlerResult>;
  close(): Promise<void>;
  isClosed(): boolean;
}>;

type PreparedSnapshot = Readonly<{
  result: PersistenceEnsureResult;
  transactionReadMs: number;
  decodeMs: number;
}>;

const sameIdentity = (left: PersistenceLaneIdentity, right: PersistenceLaneIdentity) =>
  left.worldId === right.worldId &&
  left.seedText === right.seedText &&
  left.generatorVersion === right.generatorVersion;

function readEnsureRequest(value: unknown): PersistenceEnsureRequest {
  const request = value as Partial<PersistenceEnsureRequest>;
  if (
    !request ||
    typeof request.key !== 'string' ||
    !Number.isSafeInteger(request.cx) ||
    !Number.isSafeInteger(request.cy) ||
    !Number.isSafeInteger(request.cz) ||
    request.key !== chunkKey(request.cx!, request.cy!, request.cz!)
  )
    throw new TypeError('Persistence lane prepare 请求无效。');
  return { key: request.key, cx: request.cx!, cy: request.cy!, cz: request.cz! };
}

function readNeighborhoodRequest(value: unknown): PersistenceNeighborhoodRequest {
  const request = value as Partial<PersistenceNeighborhoodRequest>;
  if (
    !request ||
    !Number.isSafeInteger(request.cx) ||
    !Number.isSafeInteger(request.cy) ||
    !Number.isSafeInteger(request.cz) ||
    !Array.isArray(request.residentKeys) ||
    request.residentKeys.length > 27 ||
    request.residentKeys.some((key) => typeof key !== 'string')
  )
    throw new TypeError('Persistence lane neighborhood 请求无效。');
  return {
    cx: request.cx!,
    cy: request.cy!,
    cz: request.cz!,
    residentKeys: [...request.residentKeys],
  };
}

function transferFor(value: unknown): readonly Transferable[] {
  const transfers = new Set<ArrayBuffer>();
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object') return;
    if (ArrayBuffer.isView(candidate)) {
      if (candidate.buffer instanceof ArrayBuffer) transfers.add(candidate.buffer);
      return;
    }
    if (candidate instanceof ArrayBuffer) {
      transfers.add(candidate);
      return;
    }
    if (Array.isArray(candidate)) candidate.forEach(visit);
    else Object.values(candidate as Record<string, unknown>).forEach(visit);
  };
  visit(value);
  return [...transfers];
}

export function createPersistenceLaneRequestHandler(options: {
  store: FileGamePersistence;
  identity: PersistenceLaneIdentity;
}): PersistenceLaneRequestHandler {
  let opened = false;
  let closed = false;
  let closePromise: Promise<void> | null = null;
  const preparations = new Map<string, Promise<PreparedSnapshot>>();

  const close = (): Promise<void> => {
    if (!closePromise) {
      closed = true;
      closePromise = options.store.close();
    }
    return closePromise;
  };

  const ensureOpen = (): void => {
    if (closed) throw new Error('Persistence lane 已关闭。');
    if (!opened) throw new Error('Persistence lane 尚未完成 open 身份握手。');
  };

  const prepare = async (request: PersistenceEnsureRequest): Promise<PreparedSnapshot> => {
    let operation = preparations.get(request.key);
    if (!operation) {
      operation = (async () => {
        const timing = await options.store.ensureSnapshotMeasured(request.cx, request.cy, request.cz);
        const snapshot = options.store.loadSnapshot(request.key);
        options.store.evictSnapshot(request.key);
        return {
          result: snapshot
            ? ({ key: request.key, status: 'found', snapshot } as const)
            : ({ key: request.key, status: 'missing' } as const),
          transactionReadMs: timing.transactionReadMs,
          decodeMs: timing.decodeMs,
        };
      })();
      preparations.set(request.key, operation);
      void operation.then(
        () => {
          if (preparations.get(request.key) === operation) preparations.delete(request.key);
        },
        () => {
          if (preparations.get(request.key) === operation) preparations.delete(request.key);
        },
      );
    }
    return structuredClone(await operation);
  };

  const handle = async ({ kind: rawKind, payload, signal }: PersistenceLaneHandleRequest): Promise<unknown> => {
    if (signal.aborted) throw signal.reason ?? new Error('Persistence lane 请求已取消。');
    const kind = rawKind as PersistenceLaneRequestKind;
    if (kind === 'persistence-open') {
      if (closed) throw new Error('Persistence lane 已关闭。');
      const request = payload as Partial<PersistenceOpenRequest>;
      if (request.version !== PERSISTENCE_LANE_PROTOCOL_VERSION || !request.identity)
        throw new TypeError('Persistence lane open 请求无效。');
      if (!sameIdentity(options.identity, request.identity)) throw new Error('Persistence lane 世界身份不匹配。');
      opened = true;
      const response: PersistenceOpenResponse = {
        version: PERSISTENCE_LANE_PROTOCOL_VERSION,
        identity: { ...options.identity },
        gameplay: options.store.loadGameplaySnapshot(),
        checkpoint: options.store.loadGameCheckpoint(),
      };
      return response;
    }
    if (kind === 'persistence-close') {
      await close();
      return {};
    }
    ensureOpen();
    if (kind === 'persistence-ensure') return (await prepare(readEnsureRequest(payload))).result;
    if (kind === 'persistence-ensure-neighborhood') {
      const request = readNeighborhoodRequest(payload);
      const coordinates: Array<[number, number, number]> = [];
      for (let y = request.cy - 1; y <= request.cy + 1; y += 1)
        for (let z = request.cz - 1; z <= request.cz + 1; z += 1)
          for (let x = request.cx - 1; x <= request.cx + 1; x += 1) coordinates.push([x, y, z]);
      const started = performance.now();
      const prepared = await Promise.all(
        coordinates.map(([cx, cy, cz]) => prepare({ key: chunkKey(cx, cy, cz), cx, cy, cz })),
      );
      const entries = prepared.map((entry) => entry.result);
      const foundCount = entries.filter((entry) => entry.status === 'found').length;
      const transactionReadMs = prepared.reduce((total, entry) => total + entry.transactionReadMs, 0);
      const decodeMs = prepared.reduce((total, entry) => total + entry.decodeMs, 0);
      const elapsed = performance.now() - started;
      const response: PersistenceNeighborhoodResponse = {
        entries,
        diagnostics: {
          requestedKeyCount: entries.length,
          foundCount,
          missingCount: entries.length - foundCount,
          queueWaitMs: 0,
          databaseMs: 0,
          transactionReadMs,
          decodeMs,
          totalWorkerMs: elapsed,
          measurementStatus: {
            queueWaitMs: 'not-collected',
            databaseMs: 'unsupported',
            transactionReadMs: 'measured',
            decodeMs: 'measured',
            totalWorkerMs: 'measured',
          },
          codecs: {},
        },
      };
      return response;
    }
    if (kind === 'persistence-save-frozen') {
      const request = payload as Partial<PersistenceSaveRequest>;
      if (!request.snapshot) throw new TypeError('Persistence lane save 请求无效。');
      await options.store.saveFrozenSnapshot(request.snapshot);
      request.snapshot.chunks.forEach((snapshot) => options.store.evictSnapshot(snapshot.key));
      const response: PersistenceSaveResponse = {
        checkpoint: {
          commitSequence: request.snapshot.commitSequence,
          worldRevision: request.snapshot.worldRevision,
        },
      };
      return response;
    }
    if (kind === 'persistence-inspect-previous') return { inspection: await options.store.inspectPreviousCheckpoint() };
    throw new TypeError(`Persistence lane 请求 kind 不受支持：${rawKind}`);
  };

  return {
    handle,
    async handleRpc(request): Promise<NodeRpcHandlerResult> {
      const payload = await handle(request);
      return { payload, transfer: transferFor(payload) };
    },
    close,
    isClosed: () => closed,
  };
}
