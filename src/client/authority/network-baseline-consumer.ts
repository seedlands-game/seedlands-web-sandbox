import { parseAuthorityChunkKey } from '../../server/authority/authority-baseline-capture';
import { NETWORK_REFERENCE_BASELINE_CELL_COUNT } from '../../server/protocol/network-reference-baseline-types';
import {
  cacheAuthorityCollisionBaseline,
  publishAuthorityCollisionCommits,
  type AuthorityCollisionCachedChunk,
  type AuthorityCollisionCommit,
} from './authority-collision-mirror';
import type {
  AuthorityCompleteMeshInputReference,
  NetworkBaselineAcceptResult,
  NetworkBaselineConsumer,
  NetworkBaselineConsumerDiagnostics,
  NetworkBaselineConsumerOptions,
  NetworkBaselineOwnerHandle,
  NetworkBaselineOwnerRef,
  NetworkBaselineWorkerResultIdentity,
  NetworkBaselineWorkerSnapshotLease,
} from './network-baseline-consumer-types';
import {
  NetworkBaselineSharedPreparationStore,
  preparationHaloIdentity,
  type OwnerPreparation,
} from './network-baseline-consumer-preparation';
import {
  canonicalEqualsLittleEndian,
  copyNetworkBaselineLimits,
  copyNetworkBaselineOwner,
  decodeCanonicalLittleEndian,
  fluidEquals,
  nativeCanonicalEquals,
  sameConsumerRef,
  validateConsumerBundle,
  validateRevisionVector,
  validateWorkerResult,
  type ValidatedBaselineEntry,
} from './network-baseline-consumer-validation';

export type {
  AuthorityCompleteMeshInputReference,
  NetworkBaselineAcceptResult,
  NetworkBaselineConsumer,
  NetworkBaselineConsumerDiagnostics,
  NetworkBaselineConsumerLimits,
  NetworkBaselineOwnerHandle,
  NetworkBaselineOwnerRef,
  NetworkBaselineWorkerResultIdentity,
  NetworkBaselineWorkerSnapshotLease,
} from './network-baseline-consumer-types';

const CANONICAL_BYTES = NETWORK_REFERENCE_BASELINE_CELL_COUNT * 2;
const FLUID_BYTES = NETWORK_REFERENCE_BASELINE_CELL_COUNT;
const CHUNK_BYTES = CANONICAL_BYTES + FLUID_BYTES;

type OwnerState = {
  handle: NetworkBaselineOwnerHandle;
  owner: NetworkBaselineOwnerRef;
  active: boolean;
  stale: boolean;
  preparation: OwnerPreparation | null;
  acceptedRevisions: Map<string, number> | null;
};

type PendingCollision = Readonly<{
  key: string;
  chunkRevision: number;
  generatorVersion: number;
  value: AuthorityCollisionCachedChunk;
  replacesExisting: boolean;
}>;

class NetworkBaselineConsumerState implements NetworkBaselineConsumer {
  private readonly limits;
  private readonly collisionChunks;
  private readonly collisionGuard;
  private readonly handles = new WeakMap<object, OwnerState>();
  private readonly ownersById = new Map<number, OwnerState>();
  private readonly ownersByKey = new Map<string, Set<OwnerState>>();
  private readonly preparationStore;
  private readonly acceptedRevisionByKey = new Map<string, number>();
  private readonly collisionGeneratorByKey = new Map<string, number>();
  private readonly collisionAccountedKeys = new Set<string>();
  private sessionRef: NetworkBaselineOwnerRef['ref'] | null = null;
  private ownerGenerationHighWatermark = -1;
  private sharedCollisionBytes = 0;
  private workerTransferBytes = 0;
  private activeWorkerSnapshots = 0;
  private closed = false;
  private closePromise: Promise<void> | null = null;
  private idleResolvers: Array<() => void> = [];

  constructor(options: NetworkBaselineConsumerOptions) {
    this.limits = copyNetworkBaselineLimits(options.limits);
    this.preparationStore = new NetworkBaselineSharedPreparationStore(this.limits.sharedPreparationBytesMax);
    if (options.collisionChunks.size !== 0)
      throw new TypeError('Network baseline consumer requires an empty dedicated collision map.');
    this.collisionChunks = options.collisionChunks;
    this.collisionGuard = options.collisionGuard;
  }

  registerOwner(value: NetworkBaselineOwnerRef): NetworkBaselineOwnerHandle {
    if (this.closed) throw new Error('Network baseline consumer is closed.');
    const owner = copyNetworkBaselineOwner(value);
    if (this.ownersById.size >= this.limits.ownersMax) throw new RangeError('Network baseline owner limit exceeded.');
    if (this.ownersById.has(owner.ownerId)) throw new TypeError('Network baseline ownerId is already active.');
    if (owner.ownerGeneration <= this.ownerGenerationHighWatermark)
      throw new TypeError('Network baseline owner generation must be strictly increasing.');
    if (this.sessionRef && !sameConsumerRef(this.sessionRef, owner.ref))
      throw new TypeError('Network baseline consumer is bound to another session ref.');
    const handle = Object.freeze({ ownerId: owner.ownerId, ownerGeneration: owner.ownerGeneration });
    const state: OwnerState = {
      handle,
      owner,
      active: true,
      stale: false,
      preparation: null,
      acceptedRevisions: null,
    };
    this.sessionRef ??= owner.ref;
    this.ownerGenerationHighWatermark = owner.ownerGeneration;
    this.ownersById.set(owner.ownerId, state);
    this.handles.set(handle, state);
    for (const expected of owner.expectedEntries) {
      let owners = this.ownersByKey.get(expected.key);
      if (!owners) {
        owners = new Set();
        this.ownersByKey.set(expected.key, owners);
      }
      owners.add(state);
      this.collisionGuard.require(expected.key, expected.minimumRevision);
      this.advanceOwnedRevision(expected.key, expected.minimumRevision);
    }
    return handle;
  }

  accept(
    ownerHandle: NetworkBaselineOwnerHandle,
    bundle: Parameters<NetworkBaselineConsumer['accept']>[1],
  ): NetworkBaselineAcceptResult {
    const state = this.activeState(ownerHandle);
    if (!state || this.closed) return { status: 'rejected', reason: 'late-owner' };
    const entries = validateConsumerBundle(bundle, state.owner);
    if (!entries) return { status: 'rejected', reason: 'identity-mismatch' };
    const preflight = this.preflight(state, entries);
    if (preflight?.status === 'satisfied-by-newer') {
      const current = this.collisionChunks.get(state.owner.key)!;
      state.stale = false;
      state.acceptedRevisions = new Map([[state.owner.key, current.chunkRevision]]);
      this.acceptedRevisionByKey.set(
        state.owner.key,
        Math.max(this.acceptedRevisionByKey.get(state.owner.key) ?? 0, current.chunkRevision),
      );
      this.collisionGuard.satisfy(state.owner.key, current.chunkRevision);
      return preflight;
    }
    if (preflight) return preflight;
    return this.install(state, entries);
  }

  snapshotForWorker(ownerHandle: NetworkBaselineOwnerHandle): NetworkBaselineWorkerSnapshotLease | null {
    const state = this.activeState(ownerHandle);
    if (!state || state.stale || !state.preparation || state.owner.purpose !== 'mesh' || this.closed) return null;
    const bytes = state.preparation.entries.length * CHUNK_BYTES;
    if (this.workerTransferBytes + bytes > this.limits.workerTransferBytesMax) return null;
    this.workerTransferBytes += bytes;
    this.activeWorkerSnapshots += 1;
    try {
      const [main, ...overlayEntries] = state.preparation.entries;
      const overlays = overlayEntries.map((entry) => {
        const [cx, cy, cz] = parseAuthorityChunkKey(entry.key);
        return Object.freeze({
          cx,
          cy,
          cz,
          voxels: entry.canonical.slice(),
          fluid: entry.fluid.slice(),
        });
      });
      const input: AuthorityCompleteMeshInputReference = Object.freeze({
        inputStrategy: 'authority-complete',
        chunkRevision: main!.chunkRevision,
        generatorVersion: main!.generatorVersion,
        haloRevision: state.preparation.haloRevision,
        canonical: main!.canonical.slice(),
        fluid: main!.fluid.slice(),
        overlays: Object.freeze(overlays),
      });
      let settled = false;
      return Object.freeze({
        input,
        settle: () => {
          if (settled) return;
          settled = true;
          this.workerTransferBytes -= bytes;
          this.activeWorkerSnapshots -= 1;
          this.resolveIdle();
        },
      });
    } catch (error) {
      this.workerTransferBytes -= bytes;
      this.activeWorkerSnapshots -= 1;
      this.resolveIdle();
      throw error;
    }
  }

  acceptWorkerResult(ownerHandle: NetworkBaselineOwnerHandle, value: NetworkBaselineWorkerResultIdentity): boolean {
    const state = this.activeState(ownerHandle);
    if (!state || state.stale || !state.preparation || state.owner.purpose !== 'mesh' || this.closed) return false;
    const result = validateWorkerResult(value);
    const main = state.preparation.entries[0]!;
    return (
      result.key === state.owner.key &&
      result.chunkRevision === main.chunkRevision &&
      result.generatorVersion === main.generatorVersion &&
      result.haloRevision === state.preparation.haloRevision &&
      nativeCanonicalEquals(main.canonical, result.canonical)
    );
  }

  observeChunkRevisions(value: readonly Readonly<{ key: string; revision: number }>[]): readonly number[] {
    if (this.closed) return [];
    const revisions = validateRevisionVector(value);
    const invalidated = new Set<number>();
    for (const { key, revision } of revisions)
      this.advanceOwnedRevision(key, revision).forEach((ownerId) => invalidated.add(ownerId));
    return Object.freeze([...invalidated].sort((left, right) => left - right));
  }

  consumeCollisionCommits<Commit extends AuthorityCollisionCommit>(
    commits: readonly Commit[] | undefined,
    callbacks: Readonly<{ onCommit?(commit: Commit): void; onUnknownChunk?(key: string): void }> = {},
  ): void {
    if (this.closed || !commits?.length) return;
    for (const commit of commits) {
      if (this.closed) return;
      if (commit.committed && commit.structuralChange)
        this.observeChunkRevisions(commit.structuralChange.chunkRevisions);
      const ownedKeys = new Set(
        commit.structuralChange?.chunkRevisions.filter(({ key }) => this.ownersByKey.has(key)).map(({ key }) => key) ??
          [],
      );
      const internal: AuthorityCollisionCommit = {
        committed: commit.committed,
        worldRevision: commit.worldRevision,
        structuralChange: commit.structuralChange
          ? {
              chunks: commit.structuralChange.chunks.filter((key) => ownedKeys.has(key)),
              chunkRevisions: commit.structuralChange.chunkRevisions.filter(({ key }) => ownedKeys.has(key)),
            }
          : null,
        ...(commit.collisionDelta
          ? { collisionDelta: commit.collisionDelta.filter(({ key }) => ownedKeys.has(key)) }
          : {}),
      };
      const unknownKeys: string[] = [];
      let published = false;
      publishAuthorityCollisionCommits(
        [internal],
        this.collisionChunks,
        {
          onCommit: () => {
            published = true;
          },
          onUnknownChunk: (key) => {
            unknownKeys.push(key);
          },
        },
        this.collisionGuard,
      );
      this.reconcileCollisionLedger();
      for (const key of unknownKeys) {
        if (this.closed) return;
        if (this.ownersByKey.has(key)) callbacks.onUnknownChunk?.(key);
      }
      if (this.closed) return;
      if (published) callbacks.onCommit?.(commit);
    }
  }

  releaseOwner(ownerHandle: NetworkBaselineOwnerHandle): void {
    const state = this.activeState(ownerHandle);
    if (!state) return;
    state.active = false;
    state.acceptedRevisions = null;
    this.ownersById.delete(state.owner.ownerId);
    this.releasePreparation(state);
    for (const expected of state.owner.expectedEntries) {
      const owners = this.ownersByKey.get(expected.key);
      owners?.delete(state);
      if (!owners?.size) {
        this.ownersByKey.delete(expected.key);
        this.acceptedRevisionByKey.delete(expected.key);
        this.collisionGuard.release(expected.key);
        this.collisionChunks.delete(expected.key);
        if (this.collisionAccountedKeys.delete(expected.key)) this.sharedCollisionBytes -= CHUNK_BYTES;
        this.collisionGeneratorByKey.delete(expected.key);
      }
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    for (const state of [...this.ownersById.values()]) this.releaseOwner(state.handle);
    this.closePromise = this.whenIdle();
    return this.closePromise;
  }

  whenIdle(): Promise<void> {
    if (this.activeWorkerSnapshots === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  diagnostics(): NetworkBaselineConsumerDiagnostics {
    return Object.freeze({
      activeOwners: this.ownersById.size,
      ownedKeys: this.ownersByKey.size,
      trackedRevisionKeys: this.acceptedRevisionByKey.size,
      sharedCollisionBytes: this.sharedCollisionBytes,
      sharedPreparationBytes: this.preparationStore.diagnostics().bytes,
      sharedPreparationEntries: this.preparationStore.diagnostics().entries,
      workerTransferBytes: this.workerTransferBytes,
      activeWorkerSnapshots: this.activeWorkerSnapshots,
      ownerGenerationHighWatermark: this.ownerGenerationHighWatermark,
      untrackedPeakBytesStatus: 'NOT_COLLECTED',
      closed: this.closed,
    });
  }

  private activeState(handle: NetworkBaselineOwnerHandle): OwnerState | null {
    if (!handle || typeof handle !== 'object') return null;
    const state = this.handles.get(handle);
    return state?.active && state.handle === handle ? state : null;
  }

  private preflight(state: OwnerState, entries: readonly ValidatedBaselineEntry[]): NetworkBaselineAcceptResult | null {
    for (const entry of entries) {
      const { key, chunkRevision, generatorVersion } = entry.descriptor;
      const activeMinimum = Math.max(
        ...[...(this.ownersByKey.get(key) ?? [])].map(
          (owner) => owner.owner.expectedEntries.find((expected) => expected.key === key)!.minimumRevision,
        ),
      );
      const acceptedRevision = this.acceptedRevisionByKey.get(key) ?? 0;
      const current = this.collisionChunks.get(key);
      if (
        state.owner.purpose === 'collision-resync' &&
        current &&
        current.chunkRevision > chunkRevision &&
        current.chunkRevision >= activeMinimum &&
        current.chunkRevision >= acceptedRevision
      )
        return { status: 'satisfied-by-newer' };
      if (chunkRevision < activeMinimum || chunkRevision < acceptedRevision)
        return { status: 'rejected', reason: 'superseded' };
      if (!this.collisionGuard.accepts(key, chunkRevision)) return { status: 'rejected', reason: 'superseded' };
      if (current && current.chunkRevision > chunkRevision)
        return state.owner.purpose === 'collision-resync'
          ? { status: 'satisfied-by-newer' }
          : { status: 'rejected', reason: 'superseded' };
      if (
        current &&
        current.chunkRevision === chunkRevision &&
        (this.collisionGeneratorByKey.get(key) !== generatorVersion ||
          !canonicalEqualsLittleEndian(current.canonical, entry.canonicalLittleEndian) ||
          !fluidEquals(current.fluid, entry.fluid))
      )
        return { status: 'rejected', reason: 'conflicting-content' };
    }
    if (state.owner.purpose === 'mesh') {
      const preparationFailure = this.preparationStore.preflight(entries);
      if (preparationFailure) return { status: 'rejected', reason: preparationFailure };
    }
    const newCollisionBytes = entries.reduce(
      (bytes, entry) =>
        bytes +
        ((this.collisionChunks.get(entry.descriptor.key)?.chunkRevision ?? -1) < entry.descriptor.chunkRevision
          ? CHUNK_BYTES
          : 0),
      0,
    );
    if (this.sharedCollisionBytes + newCollisionBytes > this.limits.sharedCollisionBytesMax)
      return { status: 'rejected', reason: 'resource-limit' };
    return null;
  }

  private install(state: OwnerState, entries: readonly ValidatedBaselineEntry[]): NetworkBaselineAcceptResult {
    const pendingCollisions: PendingCollision[] = [];
    let reservedCollisionBytes = 0;
    for (const entry of entries) {
      const current = this.collisionChunks.get(entry.descriptor.key);
      if ((current?.chunkRevision ?? -1) >= entry.descriptor.chunkRevision) continue;
      reservedCollisionBytes += CHUNK_BYTES;
    }
    this.sharedCollisionBytes += reservedCollisionBytes;
    let preparationEntries: OwnerPreparation['entries'] = [];
    try {
      if (state.owner.purpose === 'mesh') preparationEntries = this.preparationStore.acquire(entries);
      for (const entry of entries) {
        const current = this.collisionChunks.get(entry.descriptor.key);
        if ((current?.chunkRevision ?? -1) >= entry.descriptor.chunkRevision) continue;
        pendingCollisions.push({
          key: entry.descriptor.key,
          chunkRevision: entry.descriptor.chunkRevision,
          generatorVersion: entry.descriptor.generatorVersion,
          value: {
            canonical: decodeCanonicalLittleEndian(entry.canonicalLittleEndian),
            fluid: entry.fluid.slice(),
            chunkRevision: entry.descriptor.chunkRevision,
          },
          replacesExisting: !!current,
        });
      }
    } catch (error) {
      this.preparationStore.release(preparationEntries);
      this.sharedCollisionBytes -= reservedCollisionBytes;
      throw error;
    }
    for (const pending of pendingCollisions) {
      if (!cacheAuthorityCollisionBaseline(this.collisionChunks, pending.key, pending.value, this.collisionGuard))
        throw new Error('Network baseline collision preflight became invalid during synchronous installation.');
      this.collisionGeneratorByKey.set(pending.key, pending.generatorVersion);
      this.collisionAccountedKeys.add(pending.key);
      if (pending.replacesExisting) this.sharedCollisionBytes -= CHUNK_BYTES;
    }
    for (const entry of entries) {
      const current = this.collisionChunks.get(entry.descriptor.key);
      if (current) this.collisionGuard.satisfy(entry.descriptor.key, current.chunkRevision);
    }
    const oldPreparation = state.preparation;
    state.preparation =
      state.owner.purpose === 'mesh'
        ? { entries: preparationEntries, haloRevision: preparationHaloIdentity(state.owner, preparationEntries) }
        : null;
    state.stale = false;
    state.acceptedRevisions = new Map(entries.map((entry) => [entry.descriptor.key, entry.descriptor.chunkRevision]));
    for (const entry of entries)
      this.acceptedRevisionByKey.set(
        entry.descriptor.key,
        Math.max(this.acceptedRevisionByKey.get(entry.descriptor.key) ?? 0, entry.descriptor.chunkRevision),
      );
    if (oldPreparation) this.preparationStore.release(oldPreparation.entries);
    for (const entry of entries) this.advanceOwnedRevision(entry.descriptor.key, entry.descriptor.chunkRevision, state);
    return { status: 'accepted', haloRevision: state.preparation?.haloRevision ?? null };
  }

  private releasePreparation(state: OwnerState): void {
    if (!state.preparation) return;
    this.preparationStore.release(state.preparation.entries);
    state.preparation = null;
  }

  private advanceOwnedRevision(key: string, revision: number, protectedState?: OwnerState): readonly number[] {
    const owners = this.ownersByKey.get(key);
    if (!owners?.size) return [];
    const watermark = Math.max(this.acceptedRevisionByKey.get(key) ?? 0, revision);
    this.acceptedRevisionByKey.set(key, watermark);
    const invalidated: number[] = [];
    for (const state of owners) {
      if (state === protectedState || state.stale) continue;
      const accepted = state.acceptedRevisions?.get(key);
      if (accepted === undefined || accepted >= watermark) continue;
      state.stale = true;
      state.acceptedRevisions = null;
      this.releasePreparation(state);
      invalidated.push(state.owner.ownerId);
    }
    return invalidated;
  }

  private reconcileCollisionLedger(): void {
    for (const key of [...this.collisionAccountedKeys]) {
      if (this.collisionChunks.has(key)) continue;
      this.collisionAccountedKeys.delete(key);
      this.collisionGeneratorByKey.delete(key);
      this.sharedCollisionBytes -= CHUNK_BYTES;
      const owners = this.ownersByKey.get(key);
      if (!owners) continue;
      for (const state of owners) {
        if (state.stale) continue;
        state.stale = true;
        state.acceptedRevisions = null;
        this.releasePreparation(state);
      }
    }
  }

  private resolveIdle(): void {
    if (this.activeWorkerSnapshots !== 0) return;
    const resolvers = this.idleResolvers;
    this.idleResolvers = [];
    resolvers.forEach((resolve) => resolve());
  }
}

export function createNetworkBaselineConsumer(options: NetworkBaselineConsumerOptions): NetworkBaselineConsumer {
  return new NetworkBaselineConsumerState(options);
}
