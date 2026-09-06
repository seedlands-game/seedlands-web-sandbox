import type {
  ChunkPersistence,
  ChunkPersistenceLoadDiagnostics,
  ChunkSnapshot,
} from '../../server/persistence/chunk-persistence';
import { readGameSaveCheckpoint, type GameSaveCheckpoint } from '../../server/persistence/game-save-checkpoint';
import { cloneFrozenGameSaveSnapshot, type FrozenGameSaveSnapshot } from '../../server/persistence/game-save-snapshot';
import type { GameplayPersistence } from '../../server/persistence/gameplay-persistence';
import type { GameplaySnapshot } from '../../server/gameplay/gameplay-runtime';
import { isValidChunkSnapshot } from '../../server/persistence/validate-chunk-snapshot';
import { chunkKey } from '../../world/voxel';
import type { PreviousCheckpointInspection } from './file-store-types';
import {
  createNodeRpcClient,
  type NodeRpcClient,
  type NodeRpcLimits,
  type NodeRpcPort,
} from '../runtime/node-rpc-contract';
import { validatePersistenceLaneRequest, validatePersistenceLaneResponse } from './persistence-lane-codec';
import {
  DEFAULT_PERSISTENCE_LANE_CACHE_LIMITS,
  PERSISTENCE_LANE_PROTOCOL_VERSION,
  type PersistenceEnsureResult,
  type PersistenceLaneCacheLimits,
  type PersistenceLaneDiagnostics,
  type PersistenceLaneIdentity,
  type PersistenceNeighborhoodResponse,
  type PersistenceOpenResponse,
  type PersistenceSaveResponse,
} from './persistence-lane-protocol';

export type PersistenceLaneRpc = Pick<NodeRpcClient, 'request' | 'close' | 'diagnostics'>;

type CacheEntry = { snapshot: ChunkSnapshot; generation: number; bytes: number };
type MissingEntry = { generation: number };
type Preparation = { token: number; promise: Promise<unknown> };
type CacheGuard = Readonly<{ generation: number; revision: number }>;

export type OpenNodePersistenceLaneProxyOptions = Readonly<{
  rpc: PersistenceLaneRpc;
  identity: PersistenceLaneIdentity;
  limits?: Partial<PersistenceLaneCacheLimits>;
}>;

export type NodePersistenceProxyBootstrap = Readonly<{
  identity: PersistenceLaneIdentity;
  limits: PersistenceLaneCacheLimits;
  rpcLimits: NodeRpcLimits;
  generation: number;
}>;

export type CreateNodePersistenceLaneProxyOptions = Readonly<{
  port: NodeRpcPort;
  epoch: string;
  bootstrap: NodePersistenceProxyBootstrap;
}>;

const cloneChunk = (snapshot: ChunkSnapshot): ChunkSnapshot => ({
  ...snapshot,
  voxels: snapshot.voxels.slice(),
  ...(snapshot.fluid ? { fluid: snapshot.fluid.slice() } : {}),
});

const chunkBytes = (snapshot: ChunkSnapshot): number =>
  snapshot.voxels.byteLength + (snapshot.fluid?.byteLength ?? 0) + 128 + Buffer.byteLength(snapshot.key);

const frozenBytes = (snapshot: FrozenGameSaveSnapshot): number =>
  Buffer.byteLength(JSON.stringify(snapshot.gameplay)) +
  snapshot.chunks.reduce((total, chunk) => total + chunkBytes(chunk), 0) +
  Buffer.byteLength(snapshot.seedText) +
  256;

function validateLimits(input?: Partial<PersistenceLaneCacheLimits>): PersistenceLaneCacheLimits {
  const limits = { ...DEFAULT_PERSISTENCE_LANE_CACHE_LIMITS, ...input };
  for (const [name, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Persistence lane 限制 ${name} 无效。`);
  return limits;
}

function sameIdentity(left: PersistenceLaneIdentity, right: PersistenceLaneIdentity): boolean {
  return (
    left.worldId === right.worldId &&
    left.seedText === right.seedText &&
    left.generatorVersion === right.generatorVersion
  );
}

function validateIdentity(value: unknown): PersistenceLaneIdentity {
  const identity = value as Partial<PersistenceLaneIdentity>;
  if (
    !identity ||
    typeof identity.worldId !== 'string' ||
    typeof identity.seedText !== 'string' ||
    !Number.isSafeInteger(identity.generatorVersion) ||
    identity.generatorVersion! < 1
  )
    throw new TypeError('Persistence lane 世界身份无效。');
  return {
    worldId: identity.worldId,
    seedText: identity.seedText,
    generatorVersion: identity.generatorVersion!,
  };
}

function transferBuffers(snapshot: FrozenGameSaveSnapshot): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const chunk of snapshot.chunks) {
    if (chunk.voxels.buffer instanceof ArrayBuffer) buffers.add(chunk.voxels.buffer);
    if (chunk.fluid?.buffer instanceof ArrayBuffer) buffers.add(chunk.fluid.buffer);
  }
  return [...buffers];
}

export async function openNodePersistenceLaneProxy(
  options: OpenNodePersistenceLaneProxyOptions,
): Promise<NodePersistenceLaneProxy> {
  const identity = validateIdentity(options.identity);
  const raw = await options.rpc.request('persistence-open', {
    version: PERSISTENCE_LANE_PROTOCOL_VERSION,
    identity,
  });
  const response = raw as Partial<PersistenceOpenResponse>;
  if (response.version !== undefined && response.version !== PERSISTENCE_LANE_PROTOCOL_VERSION)
    throw new Error('Persistence lane 协议版本不匹配。');
  const responseIdentity = validateIdentity(response.identity);
  if (!sameIdentity(identity, responseIdentity)) throw new Error('Persistence lane 世界身份不匹配。');
  const checkpoint = readGameSaveCheckpoint(response.checkpoint);
  return new NodePersistenceLaneProxy(
    options.rpc,
    identity,
    validateLimits(options.limits),
    structuredClone(response.gameplay),
    checkpoint,
  );
}

export function createNodePersistenceLaneProxy(
  options: CreateNodePersistenceLaneProxyOptions,
): Promise<NodePersistenceLaneProxy> {
  const rpc = createNodeRpcClient({
    port: options.port,
    epoch: options.epoch,
    generation: options.bootstrap.generation,
    limits: options.bootstrap.rpcLimits,
    validateRequest: validatePersistenceLaneRequest,
    validateResponse: validatePersistenceLaneResponse,
  });
  return openNodePersistenceLaneProxy({
    rpc,
    identity: options.bootstrap.identity,
    limits: options.bootstrap.limits,
  }).catch((error: unknown) => {
    rpc.close(error instanceof Error ? error : new Error(String(error)));
    throw error;
  });
}

export class NodePersistenceLaneProxy implements ChunkPersistence, GameplayPersistence {
  private readonly snapshots = new Map<string, CacheEntry>();
  private readonly missing = new Map<string, MissingEntry>();
  private readonly preparations = new Map<string, Preparation>();
  private nextGeneration = 1;
  private cachedBytes = 0;
  private retainedSaveBytes = 0;
  private saveTail: Promise<void> = Promise.resolve();
  private closed = false;
  private closePromise: Promise<void> | null = null;

  constructor(
    private readonly rpc: PersistenceLaneRpc,
    private readonly identity: PersistenceLaneIdentity,
    private readonly limits: PersistenceLaneCacheLimits,
    private gameplay: unknown,
    private checkpoint: GameSaveCheckpoint | null,
  ) {}

  loadSnapshot(key: string): ChunkSnapshot | null {
    const entry = this.snapshots.get(key);
    return entry ? cloneChunk(entry.snapshot) : null;
  }

  preparedSnapshotStatus(key: string) {
    if (this.snapshots.has(key)) return 'found' as const;
    if (this.missing.has(key)) return 'missing' as const;
    return 'unknown' as const;
  }

  ensureSnapshot(cx: number, cy: number, cz: number): Promise<void> {
    this.assertOpen();
    const key = chunkKey(cx, cy, cz);
    if (this.snapshots.has(key) || this.missing.has(key)) return Promise.resolve();
    const active = this.preparations.get(key);
    if (active) return active.promise.then(() => undefined);
    if (this.trackedKeyCount() >= this.limits.maxCachedChunks)
      return Promise.reject(new Error('Persistence lane prepare 元数据达到条目上限。'));
    const token = this.nextGeneration++;
    const promise = this.rpc
      .request('persistence-ensure', { key, cx, cy, cz })
      .then((raw) => this.acceptPrepared(key, cx, cy, cz, token, raw))
      .finally(() => {
        if (this.preparations.get(key)?.token === token) this.preparations.delete(key);
      });
    this.preparations.set(key, { token, promise });
    return promise;
  }

  async ensureNeighborhood(
    cx: number,
    cy: number,
    cz: number,
    residentKeys: readonly string[] = [],
  ): Promise<ChunkPersistenceLoadDiagnostics> {
    const roundTripStarted = performance.now();
    const coordinates: Array<[number, number, number]> = [];
    for (let y = cy - 1; y <= cy + 1; y += 1)
      for (let z = cz - 1; z <= cz + 1; z += 1) for (let x = cx - 1; x <= cx + 1; x += 1) coordinates.push([x, y, z]);
    const pending = coordinates.flatMap(([x, y, z]) => {
      const key = chunkKey(x, y, z);
      if (this.snapshots.has(key) || this.missing.has(key) || this.preparations.has(key)) return [];
      return [{ key, cx: x, cy: y, cz: z, token: this.nextGeneration++ }];
    });
    const existing = coordinates.flatMap(([x, y, z]) => {
      const promise = this.preparations.get(chunkKey(x, y, z))?.promise;
      return promise ? [promise] : [];
    });
    if (this.trackedKeyCount() + pending.length > this.limits.maxCachedChunks)
      throw new Error('Persistence lane neighborhood prepare 元数据达到条目上限。');
    const roundTrip = this.rpc
      .request('persistence-ensure-neighborhood', { cx, cy, cz, residentKeys: [...residentKeys] })
      .then((raw) => {
        const response = raw as Partial<PersistenceNeighborhoodResponse>;
        if (!Array.isArray(response.entries) || response.entries.length !== 27 || !response.diagnostics)
          throw new TypeError('Persistence lane neighborhood 回复无效。');
        const byKey = new Map(response.entries.map((entry) => [entry.key, entry]));
        for (const request of pending) {
          const result = byKey.get(request.key);
          if (!result) throw new TypeError(`Persistence lane neighborhood 缺少 ${request.key}。`);
          this.acceptPrepared(request.key, request.cx, request.cy, request.cz, request.token, result);
        }
        return response.diagnostics;
      })
      .finally(() => {
        for (const request of pending)
          if (this.preparations.get(request.key)?.token === request.token) this.preparations.delete(request.key);
      });
    for (const request of pending) this.preparations.set(request.key, { token: request.token, promise: roundTrip });
    const [diagnostics] = await Promise.all([roundTrip, ...existing]);
    return {
      ...diagnostics,
      roundTripMs: performance.now() - roundTripStarted,
      measurementStatus: { ...diagnostics.measurementStatus, roundTripMs: 'measured' },
    };
  }

  evictSnapshot(key: string): void {
    const cached = this.snapshots.get(key);
    if (cached) this.cachedBytes -= cached.bytes;
    this.snapshots.delete(key);
    this.missing.delete(key);
    this.preparations.delete(key);
  }

  loadGameplaySnapshot(): unknown {
    this.assertOpen();
    return structuredClone(this.gameplay);
  }

  loadGameCheckpoint(): GameSaveCheckpoint | null {
    this.assertOpen();
    return this.checkpoint ? { ...this.checkpoint } : null;
  }

  saveSnapshots(_snapshots: readonly ChunkSnapshot[]): never {
    throw new Error('Persistence lane 只允许通过原子冻结快照 saveFrozenSnapshot 写入。');
  }

  saveGameplaySnapshot(_snapshot: GameplaySnapshot): never {
    throw new Error('Persistence lane 只允许通过原子冻结快照 saveFrozenSnapshot 写入。');
  }

  saveFrozenSnapshot(snapshot: FrozenGameSaveSnapshot): Promise<void> {
    this.assertOpen();
    this.validateFrozen(snapshot);
    const copyBytes = frozenBytes(snapshot);
    const reservation = copyBytes * 2;
    if (reservation > this.limits.maxRetainedSaveBytes - this.retainedSaveBytes)
      return Promise.reject(new Error('Persistence lane 冻结保存副本超过字节上限。'));
    const retained = cloneFrozenGameSaveSnapshot(snapshot);
    const transport = cloneFrozenGameSaveSnapshot(retained);
    this.retainedSaveBytes += reservation;
    const guards = new Map<string, CacheGuard>();
    for (const chunk of retained.chunks) {
      const cached = this.snapshots.get(chunk.key);
      if (cached) guards.set(chunk.key, { generation: cached.generation, revision: cached.snapshot.revision });
    }
    let transportReserved = true;
    const operation = this.saveTail.then(async () => {
      let responsePromise: Promise<unknown>;
      try {
        responsePromise = this.rpc.request(
          'persistence-save-frozen',
          { snapshot: transport },
          { transfer: transferBuffers(transport) },
        );
      } finally {
        this.retainedSaveBytes -= copyBytes;
        transportReserved = false;
      }
      const raw = await responsePromise;
      this.acceptSave(retained, guards, raw);
    });
    const settled = operation.finally(() => {
      this.retainedSaveBytes -= copyBytes;
      if (transportReserved) this.retainedSaveBytes -= copyBytes;
    });
    this.saveTail = settled.catch(() => undefined);
    return settled;
  }

  async inspectPreviousCheckpoint(): Promise<PreviousCheckpointInspection | null> {
    this.assertOpen();
    const raw = (await this.rpc.request('persistence-inspect-previous', {})) as {
      inspection?: PreviousCheckpointInspection | null;
    };
    if (!Object.hasOwn(raw, 'inspection')) throw new TypeError('Persistence lane previous checkpoint 回复无效。');
    return structuredClone(raw.inspection ?? null);
  }

  diagnostics(): PersistenceLaneDiagnostics {
    return {
      cachedChunkCount: this.snapshots.size,
      cachedChunkBytes: this.cachedBytes,
      missingChunkCount: this.missing.size,
      prepareMetadataCount: this.preparations.size,
      retainedSaveBytes: this.retainedSaveBytes,
      durableCheckpoint: this.checkpoint ? { ...this.checkpoint } : null,
      rpc: this.rpc.diagnostics(),
    };
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = (async () => {
      await this.saveTail;
      await this.rpc.request('persistence-close', {});
      this.rpc.close();
      this.snapshots.clear();
      this.missing.clear();
      this.preparations.clear();
      this.cachedBytes = 0;
    })();
    return this.closePromise;
  }

  private acceptPrepared(key: string, cx: number, cy: number, cz: number, token: number, raw: unknown): void {
    if (this.preparations.get(key)?.token !== token) return;
    const result = raw as Partial<PersistenceEnsureResult>;
    if (result.key !== key || (result.status !== 'found' && result.status !== 'missing'))
      throw new TypeError(`Persistence lane prepare 回复 ${key} 无效。`);
    if (result.status === 'missing') {
      if (result.snapshot !== undefined) throw new TypeError(`Persistence lane missing 回复 ${key} 携带快照。`);
      this.missing.set(key, { generation: token });
      this.enforceCacheBounds();
      return;
    }
    const snapshot = result.snapshot;
    if (
      !snapshot ||
      !(snapshot.voxels instanceof Uint16Array) ||
      (snapshot.fluid !== undefined && !(snapshot.fluid instanceof Uint8Array)) ||
      !isValidChunkSnapshot(snapshot, { ...this.identity, key, cx, cy, cz })
    )
      throw new TypeError(`Persistence lane Chunk 回复 ${key} 无效。`);
    this.installSnapshot(cloneChunk(snapshot), token);
  }

  private installSnapshot(snapshot: ChunkSnapshot, generation: number): void {
    const previous = this.snapshots.get(snapshot.key);
    if (previous) this.cachedBytes -= previous.bytes;
    const bytes = chunkBytes(snapshot);
    if (bytes > this.limits.maxCachedBytes) throw new Error(`Chunk ${snapshot.key} 超过 Authority 缓存上限。`);
    this.missing.delete(snapshot.key);
    this.snapshots.set(snapshot.key, { snapshot, generation, bytes });
    this.cachedBytes += bytes;
    this.enforceCacheBounds();
  }

  private enforceCacheBounds(): void {
    while (
      this.snapshots.size + this.missing.size > this.limits.maxCachedChunks ||
      this.cachedBytes > this.limits.maxCachedBytes
    ) {
      const snapshotKey = this.snapshots.keys().next().value as string | undefined;
      if (snapshotKey !== undefined) {
        const entry = this.snapshots.get(snapshotKey)!;
        this.snapshots.delete(snapshotKey);
        this.cachedBytes -= entry.bytes;
        continue;
      }
      const missingKey = this.missing.keys().next().value as string | undefined;
      if (missingKey === undefined) break;
      this.missing.delete(missingKey);
    }
  }

  private trackedKeyCount(): number {
    return this.snapshots.size + this.missing.size + this.preparations.size;
  }

  private validateFrozen(snapshot: FrozenGameSaveSnapshot): void {
    if (
      snapshot.version !== 1 ||
      snapshot.seedText !== this.identity.seedText ||
      snapshot.generatorVersion !== this.identity.generatorVersion ||
      !Number.isSafeInteger(snapshot.commitSequence) ||
      snapshot.commitSequence < 0 ||
      !Number.isSafeInteger(snapshot.worldRevision) ||
      snapshot.worldRevision < 0
    )
      throw new TypeError('Persistence lane 冻结快照身份或 checkpoint 无效。');
  }

  private acceptSave(retained: FrozenGameSaveSnapshot, guards: ReadonlyMap<string, CacheGuard>, raw: unknown): void {
    const response = raw as Partial<PersistenceSaveResponse>;
    const checkpoint = readGameSaveCheckpoint(response.checkpoint);
    if (
      !checkpoint ||
      checkpoint.commitSequence !== retained.commitSequence ||
      checkpoint.worldRevision !== retained.worldRevision
    )
      throw new Error('Persistence lane durable ACK 与提交 checkpoint 不匹配。');
    if (this.checkpoint && checkpoint.commitSequence < this.checkpoint.commitSequence)
      throw new Error('Persistence lane durable ACK 的提交序号倒退。');
    this.checkpoint = checkpoint;
    this.gameplay = structuredClone(retained.gameplay);
    for (const snapshot of retained.chunks) {
      const guard = guards.get(snapshot.key);
      const current = this.snapshots.get(snapshot.key);
      if (!guard || !current || current.generation !== guard.generation) continue;
      if (current.snapshot.revision !== guard.revision) continue;
      if (current.snapshot.revision > snapshot.revision) continue;
      this.installSnapshot(cloneChunk(snapshot), this.nextGeneration++);
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Persistence lane proxy 已关闭。');
  }
}
