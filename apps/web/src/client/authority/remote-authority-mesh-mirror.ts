import type { WorldCommitResult } from '@seedlands/game-core/server/game-server-types';
import type { C0BinaryBlock } from '@seedlands/game-core/server/protocol/network-c0-codec';
import { createBaselineReferenceInFlightLedger } from '@seedlands/game-core/server/protocol/network-reference-baseline-budget';
import { createBaselineReferenceReassembler } from '@seedlands/game-core/server/protocol/network-reference-baseline-reassembly';
import type {
  BaselineBundleDescriptorReference,
  BaselinePageReference,
  BaselineReferenceReassembler,
} from '@seedlands/game-core/server/protocol/network-reference-baseline-types';
import type { ReferenceSessionLimits } from '@seedlands/game-core/server/protocol/network-reference-bootstrap-types';
import type { InterestSessionRef } from '@seedlands/game-core/server/protocol/network-reference-interest-control';
import { CHUNK_SIZE, chunkKey, floorDiv } from '@seedlands/game-core/world/voxel';
import { AuthorityCollisionRevisionGuard } from './authority-collision-mirror';
import { createNetworkBaselineConsumer } from './network-baseline-consumer';
import type { NetworkBaselineOwnerHandle } from './network-baseline-consumer-types';
import { digest, sizer } from './remote-authority-projections';

const BASELINE_IN_FLIGHT_BYTES = 16 * 1024 * 1024;
const MAX_REVISION_WATERMARKS = 4_096;
const MAX_IGNORED_BUNDLES = 128;
const MAX_INITIAL_DIAGNOSTIC_REQUESTS = 9;

export type RemoteBaselineDiagnosticSnapshot = Readonly<{
  requestOrdinal: number;
  state: 'requested' | 'descriptor' | 'pages' | 'ready' | 'unavailable' | 'cancelled';
  elapsedMs: number;
  descriptorElapsedMs?: number;
  readyElapsedMs?: number;
  firstPageArrivalElapsedMs?: number;
  lastPageArrivalElapsedMs?: number;
  lastVerificationElapsedMs?: number;
  expectedPages: number;
  arrivalPages: number;
  arrivalBytes: number;
  verifiedPages: number;
  verifiedBytes: number;
}>;

export type RemoteInitialBaselineDiagnostics = Readonly<{
  requests: readonly RemoteBaselineDiagnosticSnapshot[];
  reassembler: Readonly<{ activeBundles: number; digestingTransfers: number; reservedBlockBytes: number }>;
}>;

type MutableBaselineDiagnostic = {
  requestOrdinal: number;
  requestedAt: number;
  state: RemoteBaselineDiagnosticSnapshot['state'];
  descriptorAt?: number;
  readyAt?: number;
  firstPageArrivalAt?: number;
  lastPageArrivalAt?: number;
  lastVerificationAt?: number;
  expectedPages: number;
  arrivalPages: number;
  arrivalBytes: number;
  verifiedPages: number;
  verifiedBytes: number;
};

type OwnerState = {
  handle: NetworkBaselineOwnerHandle;
  descriptor: BaselineBundleDescriptorReference;
  ready: boolean;
  staleAtDescriptor: boolean;
};
type RemoteMeshTask = Readonly<{
  chunkKey: string;
  chunkRevision: number;
  haloRevision: string;
  generatorVersion: number;
}>;
type RemoteWorkerResult = Readonly<{
  canonical?: ArrayBuffer;
  authorityComplete?: true;
  proceduralVoxelSamples?: number;
  macroContextCount?: number;
  haloRevision: string;
  chunkRevision: number;
  generatorVersion?: number;
}>;
type MirrorOptions = Readonly<{
  nextRequestId(): number;
  createPending(requestId: number, timeoutMessage: string, onTimeout: () => void): Promise<void>;
  resolvePending(requestId: number): void;
  rejectPending(requestId: number, error: Error): void;
  requestBaseline(requestId: number, key: string): void;
  cancelBaseline(requestId: number): void;
  onCommit?(commit: WorldCommitResult): void;
  onUnknownChunk?(key: string): void;
  diagnosticsEnabled?: boolean;
  now?(): number;
}>;

export class RemoteAuthorityMeshMirror {
  private ownerSequence = 0;
  private readonly baselineLoads = new Map<string, Promise<void>>();
  private readonly baselineRequestIds = new Map<string, number>();
  private readonly revisionWatermarks = new Map<string, number>();
  private readonly owners = new Map<string, OwnerState>();
  private readonly ignoredBundles = new Set<number>();
  private readonly diagnosticsByRequest = new Map<number, MutableBaselineDiagnostic>();
  private diagnosticRequestSequence = 0;
  private readonly collisionChunks = new Map<
    string,
    { canonical: Uint16Array; fluid: Uint8Array; chunkRevision: number }
  >();
  private readonly collisionGuard = new AuthorityCollisionRevisionGuard();
  private readonly consumer = createNetworkBaselineConsumer({
    limits: {
      ownersMax: 512,
      sharedCollisionBytesMax: 96 * 1024 * 1024,
      sharedPreparationBytesMax: 96 * 1024 * 1024,
      workerTransferBytesMax: 96 * 1024 * 1024,
    },
    collisionChunks: this.collisionChunks,
    collisionGuard: this.collisionGuard,
  });
  private reassembler: BaselineReferenceReassembler | null = null;

  constructor(private readonly options: MirrorOptions) {}

  initialize(ref: InterestSessionRef, limits: ReferenceSessionLimits, worldRevision: number): void {
    const baselineLimits = {
      metadataBytesMax: limits.metadataBytesMax,
      reliableMessageBytesMax: limits.reliableMessageBytesMax,
      baselineTransferBytesMax: limits.baselineTransferBytesMax,
      baselineInFlightBytesMax: limits.baselineInFlightBytesMax,
      sendQueueBytesMax: limits.sendQueueBytesMax,
    };
    this.reassembler = createBaselineReferenceReassembler({
      ref,
      limits: baselineLimits,
      pagesPerBundleMax: 128,
      digest,
      sizer,
      inFlight: createBaselineReferenceInFlightLedger(BASELINE_IN_FLIGHT_BYTES),
    });
    this.collisionGuard.initializeCommitDelivery(worldRevision);
  }

  async ensure(cx: number, cy: number, cz: number): Promise<void> {
    const key = chunkKey(cx, cy, cz);
    const owner = this.owners.get(key);
    if (owner?.ready) return;
    const current = this.baselineLoads.get(key);
    if (current) return current;
    if (owner) this.releaseOwner(key, owner);
    const requestId = this.options.nextRequestId();
    if (this.options.diagnosticsEnabled && this.diagnosticRequestSequence < MAX_INITIAL_DIAGNOSTIC_REQUESTS) {
      this.diagnosticRequestSequence += 1;
      this.diagnosticsByRequest.set(requestId, {
        requestOrdinal: this.diagnosticRequestSequence,
        requestedAt: this.now(),
        state: 'requested',
        expectedPages: 0,
        arrivalPages: 0,
        arrivalBytes: 0,
        verifiedPages: 0,
        verifiedBytes: 0,
      });
    }
    this.baselineRequestIds.set(key, requestId);
    const pending = this.options.createPending(requestId, `远端区块 ${key} 同步超时。`, () =>
      this.cancelRequest(key, requestId),
    );
    const tracked = pending.finally(() => {
      if (this.baselineLoads.get(key) === tracked) this.baselineLoads.delete(key);
      if (this.baselineRequestIds.get(key) === requestId) this.baselineRequestIds.delete(key);
    });
    this.baselineLoads.set(key, tracked);
    this.options.requestBaseline(requestId, key);
    return tracked;
  }

  release(cx: number, cy: number, cz: number): void {
    const key = chunkKey(cx, cy, cz);
    const requestId = this.baselineRequestIds.get(key);
    if (requestId !== undefined) {
      this.cancelRequest(key, requestId);
      this.options.rejectPending(requestId, new Error(`远端区块 ${key} 已释放。`));
    }
    const owner = this.owners.get(key);
    if (owner) this.releaseOwner(key, owner);
  }

  prepareComplete(cx: number, cy: number, cz: number) {
    const owner = this.owners.get(chunkKey(cx, cy, cz));
    if (!owner?.ready) throw new Error(`远端区块尚未准备：${cx},${cy},${cz}。`);
    const lease = this.consumer.snapshotForWorker(owner.handle);
    if (!lease) {
      owner.ready = false;
      throw new Error(`远端区块基线已失效：${cx},${cy},${cz}。`);
    }
    return lease;
  }

  acceptMesh(task: RemoteMeshTask, result: RemoteWorkerResult): boolean {
    const owner = this.owners.get(task.chunkKey);
    if (
      !owner?.ready ||
      !result.canonical ||
      result.authorityComplete !== true ||
      result.proceduralVoxelSamples !== 0 ||
      result.macroContextCount !== 0 ||
      result.haloRevision !== task.haloRevision ||
      result.chunkRevision !== task.chunkRevision ||
      result.generatorVersion !== task.generatorVersion
    )
      return false;
    return this.consumer.acceptWorkerResult(owner.handle, {
      key: task.chunkKey,
      chunkRevision: task.chunkRevision,
      generatorVersion: result.generatorVersion,
      haloRevision: task.haloRevision,
      canonical: result.canonical,
    });
  }

  getVoxel(x: number, y: number, z: number): number {
    return this.readCell(x, y, z)?.canonical ?? 0;
  }

  getFluidCell(x: number, y: number, z: number): { level: number; source: boolean } | null {
    const packed = this.readCell(x, y, z)?.fluid ?? 0;
    return packed ? { level: packed & 0x0f, source: Boolean(packed & 0x80) } : null;
  }

  getChunkRevision(cx: number, cy: number, cz: number): number | null {
    return this.collisionChunks.get(chunkKey(cx, cy, cz))?.chunkRevision ?? null;
  }

  get readyOwnerCount(): number {
    let count = 0;
    for (const owner of this.owners.values()) if (owner.ready) count += 1;
    return count;
  }

  initialDiagnostics(): RemoteInitialBaselineDiagnostics {
    const now = this.now();
    const reassembler = this.reassembler?.diagnostics();
    return {
      requests: [...this.diagnosticsByRequest.values()].map((entry) => ({
        requestOrdinal: entry.requestOrdinal,
        state: entry.state,
        elapsedMs: Math.max(0, now - entry.requestedAt),
        ...(entry.descriptorAt === undefined ? {} : { descriptorElapsedMs: entry.descriptorAt - entry.requestedAt }),
        ...(entry.readyAt === undefined ? {} : { readyElapsedMs: entry.readyAt - entry.requestedAt }),
        ...(entry.firstPageArrivalAt === undefined
          ? {}
          : { firstPageArrivalElapsedMs: entry.firstPageArrivalAt - entry.requestedAt }),
        ...(entry.lastPageArrivalAt === undefined
          ? {}
          : { lastPageArrivalElapsedMs: entry.lastPageArrivalAt - entry.requestedAt }),
        ...(entry.lastVerificationAt === undefined
          ? {}
          : { lastVerificationElapsedMs: entry.lastVerificationAt - entry.requestedAt }),
        expectedPages: entry.expectedPages,
        arrivalPages: entry.arrivalPages,
        arrivalBytes: entry.arrivalBytes,
        verifiedPages: entry.verifiedPages,
        verifiedBytes: entry.verifiedBytes,
      })),
      reassembler: {
        activeBundles: reassembler?.activeBundles ?? 0,
        digestingTransfers: reassembler?.digestingTransfers ?? 0,
        reservedBlockBytes: reassembler?.reservedBlockBytes ?? 0,
      },
    };
  }

  rejectUnavailable(requestId: number): void {
    const diagnostic = this.diagnosticsByRequest.get(requestId);
    if (diagnostic) diagnostic.state = 'unavailable';
  }

  acceptDescriptor(message: Record<string, unknown>): void {
    const descriptor = message.descriptor as BaselineBundleDescriptorReference;
    this.requireReassembler().acceptDescriptor(descriptor);
    if (this.baselineRequestIds.get(descriptor.key) !== descriptor.requestId) {
      this.ignoreBundle(descriptor.bundleId);
      void this.reassembler?.cancel(descriptor.bundleId).catch(() => undefined);
      return;
    }
    const diagnostic = this.diagnosticsByRequest.get(descriptor.requestId);
    if (diagnostic) {
      diagnostic.state = 'descriptor';
      diagnostic.descriptorAt = this.now();
      diagnostic.expectedPages = descriptor.entries.reduce(
        (total, entry) => total + entry.blocks.reduce((entryTotal, block) => entryTotal + block.pageCount, 0),
        0,
      );
    }
    const staleAtDescriptor = descriptor.entries.some(
      (entry) => entry.chunkRevision < (this.revisionWatermarks.get(entry.key) ?? 0),
    );
    const existing = this.owners.get(descriptor.key);
    if (existing) this.releaseOwner(descriptor.key, existing);
    const handle = this.consumer.registerOwner({
      ref: descriptor.ref,
      ownerId: ++this.ownerSequence,
      ownerGeneration: this.ownerSequence,
      requestId: descriptor.requestId,
      interestId: descriptor.interestId,
      purpose: descriptor.purpose,
      key: descriptor.key,
      generatorVersion: descriptor.entries[0]!.generatorVersion,
      expectedEntries: descriptor.entries.map((entry, index) => ({
        key: entry.key,
        minimumRevision: index === 0 ? descriptor.minimumRevision : entry.chunkRevision,
      })),
    });
    this.owners.set(descriptor.key, { handle, descriptor, ready: false, staleAtDescriptor });
  }

  async acceptPage(message: Record<string, unknown>, blocks: readonly C0BinaryBlock[]): Promise<void> {
    const block = blocks.find((candidate) => candidate.name === message.payloadBlock);
    if (!block) throw new Error('Node baseline page 缺少 payload。');
    const page = { ...(message.page as BaselinePageReference), bytes: block.bytes };
    if (this.ignoredBundles.has(page.bundleId)) return;
    const diagnostic = this.diagnosticsByRequest.get(page.requestId);
    if (diagnostic) {
      diagnostic.state = 'pages';
      const arrivedAt = this.now();
      diagnostic.firstPageArrivalAt ??= arrivedAt;
      diagnostic.lastPageArrivalAt = arrivedAt;
      diagnostic.arrivalPages += 1;
      diagnostic.arrivalBytes += block.bytes.byteLength;
    }
    const bundle = await this.requireReassembler().acceptPage(page);
    if (diagnostic) {
      diagnostic.verifiedPages += 1;
      diagnostic.verifiedBytes += block.bytes.byteLength;
      diagnostic.lastVerificationAt = this.now();
    }
    if (!bundle) return;
    const owner = this.owners.get(bundle.descriptor.key);
    if (!owner || owner.descriptor.bundleId !== bundle.descriptor.bundleId) {
      this.options.rejectPending(bundle.descriptor.requestId, new Error('区块基线请求已被更新。'));
      return;
    }
    if (owner.staleAtDescriptor) {
      this.releaseOwner(bundle.descriptor.key, owner);
      this.options.rejectPending(bundle.descriptor.requestId, new Error('区块基线捕获期间已过期。'));
      return;
    }
    const accepted = this.consumer.accept(owner.handle, bundle);
    if (accepted.status === 'rejected' && accepted.reason === 'superseded') {
      this.releaseOwner(bundle.descriptor.key, owner);
      this.options.rejectPending(bundle.descriptor.requestId, new Error('区块基线捕获期间已过期。'));
      return;
    }
    if (accepted.status === 'rejected') throw new Error(`Node baseline 被拒绝：${accepted.reason}。`);
    owner.ready = true;
    if (diagnostic) {
      diagnostic.state = 'ready';
      diagnostic.readyAt = this.now();
    }
    this.options.resolvePending(bundle.descriptor.requestId);
  }

  consumeCommits(commits: readonly WorldCommitResult[]): void {
    for (const commit of commits)
      for (const entry of commit.structuralChange?.chunkRevisions ?? []) {
        this.revisionWatermarks.set(entry.key, Math.max(this.revisionWatermarks.get(entry.key) ?? 0, entry.revision));
        while (this.revisionWatermarks.size > MAX_REVISION_WATERMARKS)
          this.revisionWatermarks.delete(this.revisionWatermarks.keys().next().value!);
        for (const owner of this.owners.values())
          if (
            owner.descriptor.entries.some(
              (candidate) => candidate.key === entry.key && candidate.chunkRevision < entry.revision,
            )
          ) {
            owner.ready = false;
            owner.staleAtDescriptor = true;
          }
      }
    this.consumer.consumeCollisionCommits(commits, {
      onCommit: (commit) => this.options.onCommit?.(commit),
      onUnknownChunk: (key) => this.options.onUnknownChunk?.(key),
    });
  }

  dispose(): void {
    for (const [key, owner] of this.owners) this.releaseOwner(key, owner);
    this.baselineLoads.clear();
    this.baselineRequestIds.clear();
    void this.reassembler?.close().catch(() => undefined);
    void this.consumer.close().catch(() => undefined);
  }

  private cancelRequest(key: string, requestId: number): void {
    if (this.baselineRequestIds.get(key) !== requestId) return;
    const owner = this.owners.get(key);
    if (owner?.descriptor.requestId === requestId) {
      void this.reassembler?.cancel(owner.descriptor.bundleId).catch(() => undefined);
      this.releaseOwner(key, owner);
    }
    this.baselineRequestIds.delete(key);
    const diagnostic = this.diagnosticsByRequest.get(requestId);
    if (diagnostic) diagnostic.state = 'cancelled';
    this.options.cancelBaseline(requestId);
  }

  private now(): number {
    return this.options.now?.() ?? performance.now();
  }

  private releaseOwner(key: string, owner: OwnerState): void {
    this.consumer.releaseOwner(owner.handle);
    this.owners.delete(key);
  }

  private ignoreBundle(bundleId: number): void {
    this.ignoredBundles.add(bundleId);
    while (this.ignoredBundles.size > MAX_IGNORED_BUNDLES)
      this.ignoredBundles.delete(this.ignoredBundles.values().next().value!);
  }

  private readCell(x: number, y: number, z: number): { canonical: number; fluid: number } | null {
    const key = chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
    const chunk = this.collisionChunks.get(key);
    if (!chunk || !this.collisionGuard.isReadable(key, chunk.chunkRevision)) return null;
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const index = lx + lz * CHUNK_SIZE + ly * CHUNK_SIZE * CHUNK_SIZE;
    return { canonical: chunk.canonical[index] ?? 0, fluid: chunk.fluid[index] ?? 0 };
  }

  private requireReassembler(): BaselineReferenceReassembler {
    if (!this.reassembler) throw new Error('Node baseline reassembler 尚未初始化。');
    return this.reassembler;
  }
}
