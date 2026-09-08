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
}>;

export class RemoteAuthorityMeshMirror {
  private ownerSequence = 0;
  private readonly baselineLoads = new Map<string, Promise<void>>();
  private readonly baselineRequestIds = new Map<string, number>();
  private readonly revisionWatermarks = new Map<string, number>();
  private readonly owners = new Map<string, OwnerState>();
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

  acceptDescriptor(message: Record<string, unknown>): void {
    const descriptor = message.descriptor as BaselineBundleDescriptorReference;
    this.requireReassembler().acceptDescriptor(descriptor);
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
    const bundle = await this.requireReassembler().acceptPage(page);
    if (!bundle) return;
    const owner = this.owners.get(bundle.descriptor.key);
    if (!owner || owner.descriptor.bundleId !== bundle.descriptor.bundleId)
      throw new Error('Node baseline owner 已失效。');
    if (owner.staleAtDescriptor) {
      this.releaseOwner(bundle.descriptor.key, owner);
      this.options.rejectPending(bundle.descriptor.requestId, new Error('区块基线捕获期间已过期。'));
      return;
    }
    const accepted = this.consumer.accept(owner.handle, bundle);
    if (accepted.status === 'rejected') throw new Error(`Node baseline 被拒绝：${accepted.reason}。`);
    owner.ready = true;
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
          )
            owner.ready = false;
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
    this.options.cancelBaseline(requestId);
  }

  private releaseOwner(key: string, owner: OwnerState): void {
    this.consumer.releaseOwner(owner.handle);
    this.owners.delete(key);
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
