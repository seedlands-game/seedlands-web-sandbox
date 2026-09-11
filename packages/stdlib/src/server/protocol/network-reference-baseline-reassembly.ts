import {
  assertBaselineLimits,
  assertExactRecord,
  copyBaselineSessionRef,
  freezeBaselineDescriptor,
  measuredBytes,
  referenceIdentifier,
  sameBaselineSessionRef,
  validateBaselineDescriptor,
} from './network-reference-baseline-validation';
import {
  NETWORK_REFERENCE_BASELINE_COMPLETION_WINDOW,
  NETWORK_REFERENCE_BASELINE_PAGES_MAX,
  NETWORK_REFERENCE_BASELINE_VERSION,
  type BaselineBlockDescriptorReference,
  type BaselineBundleDescriptorReference,
  type BaselineReferenceByteLease,
  type BaselineReferenceReassembler,
  type BaselineReferenceReassemblerOptions,
  type ReassembledBaselineReference,
} from './network-reference-baseline-types';

type TransferState = {
  descriptor: BaselineBlockDescriptorReference;
  entryId: number;
  buffer: Uint8Array;
  received: boolean[];
  receivedCount: number;
  digest: Promise<void> | null;
  verified: boolean;
};

type BundleState = {
  descriptor: BaselineBundleDescriptorReference;
  reservation: BaselineReferenceByteLease;
  transfers: Map<number, TransferState>;
  closing: boolean;
  terminal: boolean;
  clearPromise: Promise<void> | null;
};

const PAGE_FIELDS = [
  'kind',
  'projectionVersion',
  'wireStatus',
  'ref',
  'requestId',
  'interestId',
  'bundleId',
  'purpose',
  'entryId',
  'transferId',
  'block',
  'pageIndex',
  'pageCount',
  'byteOffset',
  'bytes',
] as const;

class ReferenceReassembler implements BaselineReferenceReassembler {
  private readonly ref;
  private readonly limits;
  private readonly pagesPerBundleMax: number;
  private readonly active = new Map<number, BundleState>();
  private readonly completed = new Map<number, true>();
  private readonly idleWaiters = new Set<() => void>();
  private highWatermark = -1;
  private digestingTransfers = 0;
  private reservedBlockBytes = 0;
  private closed = false;

  constructor(private readonly options: BaselineReferenceReassemblerOptions) {
    this.ref = copyBaselineSessionRef(options.ref, 'reassembler trusted ref');
    this.limits = assertBaselineLimits(options.limits);
    this.pagesPerBundleMax = referenceIdentifier(options.pagesPerBundleMax, 'pagesPerBundleMax', 1);
    if (this.pagesPerBundleMax > NETWORK_REFERENCE_BASELINE_PAGES_MAX)
      throw new RangeError('pagesPerBundleMax exceeds the reference ceiling.');
    if (options.inFlight.limitBytes > this.limits.baselineInFlightBytesMax)
      throw new RangeError('Reassembler in-flight ledger exceeds the trusted limit.');
    if (options.digest.algorithm !== 'sha-256' || typeof options.digest.digest !== 'function')
      throw new TypeError('Reassembler digest port is invalid.');
  }

  acceptDescriptor(value: unknown): void {
    if (this.closed) throw new Error('Baseline reassembler is closed.');
    const descriptor = validateBaselineDescriptor(value, {
      ref: this.ref,
      limits: this.limits,
      pagesPerBundleMax: this.pagesPerBundleMax,
      sizer: this.options.sizer,
    });
    if (descriptor.bundleId <= this.highWatermark)
      throw new RangeError('Baseline bundleId must be strictly increasing in descriptor arrival order.');
    let bytes = 0;
    for (const entry of descriptor.entries) for (const block of entry.blocks) bytes += block.byteLength;
    if (!Number.isSafeInteger(bytes) || bytes > this.limits.baselineInFlightBytesMax)
      throw new RangeError('Baseline descriptor exceeds the in-flight limit.');
    const reservation = this.options.inFlight.reserve(bytes);
    if (!reservation) throw new RangeError('Baseline reassembler has no in-flight capacity.');
    try {
      const transfers = new Map<number, TransferState>();
      for (const entry of descriptor.entries)
        for (const block of entry.blocks)
          transfers.set(block.transferId, {
            descriptor: block,
            entryId: entry.entryId,
            buffer: new Uint8Array(block.byteLength),
            received: Array.from({ length: block.pageCount }, () => false),
            receivedCount: 0,
            digest: null,
            verified: false,
          });
      this.active.set(descriptor.bundleId, {
        descriptor,
        reservation,
        transfers,
        closing: false,
        terminal: false,
        clearPromise: null,
      });
      this.reservedBlockBytes += bytes;
      this.highWatermark = descriptor.bundleId;
    } catch (error) {
      reservation.release();
      throw error;
    }
  }

  async acceptPage(value: unknown): Promise<ReassembledBaselineReference | null> {
    const associated = this.associatedState(value);
    try {
      const source = assertExactRecord(value, PAGE_FIELDS, 'baseline page');
      const bundleId = referenceIdentifier(source.bundleId, 'baseline page bundleId');
      const state = this.active.get(bundleId);
      if (!state || state.closing || state.terminal) throw new Error('Baseline page has no active descriptor.');
      const { pageIndex, byteOffset, bytes, transfer } = this.validatePage(source, state);
      if (transfer.received[pageIndex]) throw new TypeError('Baseline page is duplicated.');
      transfer.received[pageIndex] = true;
      transfer.receivedCount += 1;
      transfer.buffer.set(bytes, byteOffset);
      if (transfer.receivedCount === transfer.received.length) await this.verifyTransfer(state, transfer);
      if (
        state.closing ||
        state.terminal ||
        this.active.get(bundleId) !== state ||
        ![...state.transfers.values()].every((candidate) => candidate.verified)
      )
        return null;
      state.terminal = true;
      return this.finish(state);
    } catch (error) {
      if (associated)
        await this.clearBundle(
          associated.descriptor.bundleId,
          error instanceof HashMismatchError ? 'hash-error' : 'schema-error',
        );
      throw error;
    }
  }

  clearBundle(bundleId: number, _reason: 'cancelled' | 'timeout' | 'schema-error' | 'hash-error'): Promise<void> {
    referenceIdentifier(bundleId, 'bundleId');
    const state = this.active.get(bundleId);
    if (!state) return Promise.resolve();
    if (state.clearPromise) return state.clearPromise;
    state.closing = true;
    state.clearPromise = (async () => {
      const digests = [...state.transfers.values()].flatMap((transfer) => (transfer.digest ? [transfer.digest] : []));
      await Promise.allSettled(digests);
      if (this.active.get(bundleId) !== state) return;
      this.active.delete(bundleId);
      const bytes = state.reservation.bytes;
      state.transfers.clear();
      state.reservation.release();
      this.reservedBlockBytes -= bytes;
      this.remember(bundleId);
      this.notifyIdle();
    })();
    return state.clearPromise;
  }

  async cancel(bundleId: number): Promise<'cancelled' | 'already-settled' | 'unknown'> {
    referenceIdentifier(bundleId, 'bundleId');
    if (this.active.has(bundleId)) {
      await this.clearBundle(bundleId, 'cancelled');
      return 'cancelled';
    }
    return this.completed.has(bundleId) ? 'already-settled' : 'unknown';
  }

  async close(): Promise<void> {
    if (!this.closed) this.closed = true;
    await Promise.all([...this.active.keys()].map((bundleId) => this.clearBundle(bundleId, 'cancelled')));
  }

  whenIdle(): Promise<void> {
    if (!this.active.size) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  diagnostics() {
    return Object.freeze({
      activeBundles: this.active.size,
      digestingTransfers: this.digestingTransfers,
      reservedBlockBytes: this.reservedBlockBytes,
      bundleIdHighWatermark: this.highWatermark,
    });
  }

  private associatedState(value: unknown): BundleState | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const bundleProperty = Object.getOwnPropertyDescriptor(value, 'bundleId');
    const refProperty = Object.getOwnPropertyDescriptor(value, 'ref');
    if (!bundleProperty || !('value' in bundleProperty) || !refProperty || !('value' in refProperty)) return null;
    let bundleId: number;
    try {
      bundleId = referenceIdentifier(bundleProperty.value, 'baseline page bundleId');
      const ref = copyBaselineSessionRef(refProperty.value, 'baseline page ref');
      if (!sameBaselineSessionRef(ref, this.ref)) return null;
    } catch {
      return null;
    }
    return this.active.get(bundleId) ?? null;
  }

  private validatePage(
    source: Record<string, unknown>,
    state: BundleState,
  ): { pageIndex: number; byteOffset: number; bytes: Uint8Array; transfer: TransferState } {
    if (
      source.kind !== 'baseline-page-reference' ||
      source.projectionVersion !== NETWORK_REFERENCE_BASELINE_VERSION ||
      source.wireStatus !== 'not-adopted'
    )
      throw new TypeError('Baseline page identity is invalid.');
    const ref = copyBaselineSessionRef(source.ref, 'baseline page ref');
    const descriptor = state.descriptor;
    if (
      !sameBaselineSessionRef(ref, descriptor.ref) ||
      source.requestId !== descriptor.requestId ||
      source.interestId !== descriptor.interestId ||
      source.bundleId !== descriptor.bundleId ||
      source.purpose !== descriptor.purpose
    )
      throw new TypeError('Baseline page does not match its descriptor.');
    const entryId = referenceIdentifier(source.entryId, 'baseline page entryId');
    const transferId = referenceIdentifier(source.transferId, 'baseline page transferId');
    const transfer = state.transfers.get(transferId);
    if (!transfer || transfer.entryId !== entryId || source.block !== transfer.descriptor.name)
      throw new TypeError('Baseline page transfer identity is invalid.');
    const pageIndex = referenceIdentifier(source.pageIndex, 'baseline pageIndex');
    if (source.pageCount !== transfer.descriptor.pageCount || pageIndex >= transfer.descriptor.pageCount)
      throw new TypeError('Baseline page count is invalid.');
    const byteOffset = pageIndex * transfer.descriptor.referencePagePayloadBytes;
    const expectedLength = Math.min(
      transfer.descriptor.referencePagePayloadBytes,
      transfer.descriptor.byteLength - byteOffset,
    );
    if (
      source.byteOffset !== byteOffset ||
      !(source.bytes instanceof Uint8Array) ||
      source.bytes.byteLength !== expectedLength
    )
      throw new TypeError('Baseline page byte range is invalid.');
    const metadata = Object.freeze({
      kind: source.kind,
      projectionVersion: source.projectionVersion,
      wireStatus: source.wireStatus,
      ref,
      requestId: source.requestId,
      interestId: source.interestId,
      bundleId: source.bundleId,
      purpose: source.purpose,
      entryId,
      transferId,
      block: source.block,
      pageIndex,
      pageCount: source.pageCount,
      byteOffset,
    });
    const metadataBytes = measuredBytes(this.options.sizer.measureMetadataBytes(metadata), 'page metadata bytes');
    if (metadataBytes > this.limits.metadataBytesMax) throw new RangeError('Baseline page metadata exceeds its limit.');
    const reliableBytes = measuredBytes(
      this.options.sizer.measureReliableMessageBytes(metadata, source.bytes),
      'page reliable bytes',
    );
    if (reliableBytes > this.limits.reliableMessageBytesMax)
      throw new RangeError('Baseline page exceeds its reliable message limit.');
    return {
      pageIndex,
      byteOffset,
      bytes: source.bytes,
      transfer,
    };
  }

  private async verifyTransfer(state: BundleState, transfer: TransferState): Promise<void> {
    if (!transfer.digest) {
      this.digestingTransfers += 1;
      transfer.digest = Promise.resolve()
        .then(() => this.options.digest.digest(transfer.buffer))
        .then((hash) => {
          if (hash !== transfer.descriptor.sha256) throw new HashMismatchError();
          transfer.verified = true;
        })
        .finally(() => {
          this.digestingTransfers -= 1;
        });
      void transfer.digest.catch(() => {});
    }
    await transfer.digest;
    if (state.closing) return;
  }

  private finish(state: BundleState): ReassembledBaselineReference {
    const descriptor = state.descriptor;
    if (!state.terminal || state.closing || this.active.get(descriptor.bundleId) !== state)
      throw new Error('Baseline bundle is not ready for terminal delivery.');
    const entries = descriptor.entries.map((entry) => {
      const canonical = state.transfers.get(entry.blocks[0].transferId)!;
      const fluid = state.transfers.get(entry.blocks[1].transferId)!;
      return Object.freeze({
        entryId: entry.entryId,
        canonicalLittleEndian: canonical.buffer,
        fluid: fluid.buffer,
      });
    });
    this.active.delete(descriptor.bundleId);
    this.reservedBlockBytes -= state.reservation.bytes;
    state.reservation.release();
    state.transfers.clear();
    this.remember(descriptor.bundleId);
    this.notifyIdle();
    return Object.freeze({ descriptor: freezeBaselineDescriptor(descriptor), entries: Object.freeze(entries) });
  }

  private remember(bundleId: number): void {
    this.completed.set(bundleId, true);
    while (this.completed.size > NETWORK_REFERENCE_BASELINE_COMPLETION_WINDOW)
      this.completed.delete(this.completed.keys().next().value!);
  }

  private notifyIdle(): void {
    if (this.active.size) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}

class HashMismatchError extends Error {
  constructor() {
    super('Baseline block hash does not match its descriptor.');
  }
}

export function createBaselineReferenceReassembler(
  options: BaselineReferenceReassemblerOptions,
): BaselineReferenceReassembler {
  return new ReferenceReassembler(options);
}
