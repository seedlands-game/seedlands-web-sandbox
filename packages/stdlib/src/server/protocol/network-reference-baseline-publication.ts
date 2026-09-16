import {
  PreparedBaselineBundle,
  type BaselineOwnedBlock,
  type BaselineOwnedEntry,
  type BaselineTrustedProjection,
} from './network-reference-baseline-owned';
import {
  freezeBaselineDescriptor,
  measuredBytes,
  referenceIdentifier,
  validateBaselineDescriptor,
} from './network-reference-baseline-validation';
import {
  NETWORK_REFERENCE_BASELINE_CELL_COUNT,
  NETWORK_REFERENCE_BASELINE_PUBLICATION_QUEUE_MAX,
  NETWORK_REFERENCE_BASELINE_VERSION,
  type BaselineBlockDescriptorReference,
  type BaselineBundleDescriptorReference,
  type BaselineDescriptorLease,
  type BaselinePageLease,
  type BaselinePageLocator,
  type BaselineReferencePublicationQueue,
  type BaselineReferenceSendQueue,
  type PreparedBaselineBundleReference,
  type PublishedBaselineBundleReference,
} from './network-reference-baseline-types';

type PublishedBlock = BaselineOwnedBlock & { descriptor: BaselineBlockDescriptorReference };
type PublishedEntry = Omit<BaselineOwnedEntry, 'blocks'> & { blocks: readonly [PublishedBlock, PublishedBlock] };

class PublishedBundle implements PublishedBaselineBundleReference {
  private descriptorDequeued = false;
  private closed = false;
  private entries: PublishedEntry[] | null;
  private readonly materialized = new Set<string>();

  constructor(
    readonly descriptor: BaselineBundleDescriptorReference,
    entries: PublishedEntry[],
    readonly pageCount: number,
    private readonly trusted: BaselineTrustedProjection,
    private readonly releaseOwned: () => void,
    private readonly unregister: () => void,
  ) {
    this.entries = entries;
  }

  takeDescriptor(queue: BaselineReferenceSendQueue): BaselineDescriptorLease | null {
    if (this.closed || this.descriptorDequeued) throw new Error('Baseline descriptor is not queued.');
    this.assertSendQueue(queue);
    try {
      const bytes = measuredBytes(
        this.trusted.sizer.measureReliableMessageBytes(this.descriptor, new Uint8Array()),
        'descriptor reliable bytes',
      );
      if (bytes > this.trusted.limits.reliableMessageBytesMax)
        throw new RangeError('Baseline descriptor exceeds the reliable message limit.');
      const lease = queue.reserve(bytes);
      if (!lease) return null;
      this.descriptorDequeued = true;
      return Object.freeze({ descriptor: freezeBaselineDescriptor(this.descriptor), settle: lease.release });
    } catch (error) {
      this.close();
      throw error;
    }
  }

  materializePage(locator: BaselinePageLocator, queue: BaselineReferenceSendQueue): BaselinePageLease | null {
    if (this.closed || !this.entries) throw new Error('Baseline bundle is closed.');
    if (!this.descriptorDequeued) throw new Error('Baseline descriptor must leave the publication queue first.');
    this.assertSendQueue(queue);
    const entryId = referenceIdentifier(locator.entryId, 'page locator entryId');
    const pageIndex = referenceIdentifier(locator.pageIndex, 'page locator pageIndex');
    if (locator.block !== 'canonical' && locator.block !== 'fluid')
      throw new TypeError('Page locator block is invalid.');
    const entry = this.entries[entryId];
    if (!entry) throw new RangeError('Page locator entry does not exist.');
    const block = entry.blocks[locator.block === 'canonical' ? 0 : 1];
    if (pageIndex >= block.pageCount) throw new RangeError('Page locator index does not exist.');
    const marker = `${entryId}:${locator.block}:${pageIndex}`;
    if (this.materialized.has(marker)) throw new Error('Baseline page is already materialized.');
    const byteOffset = pageIndex * this.trusted.referencePagePayloadBytes;
    const length = Math.min(this.trusted.referencePagePayloadBytes, block.bytes.byteLength - byteOffset);
    const header = Object.freeze({
      kind: 'baseline-page-reference' as const,
      projectionVersion: NETWORK_REFERENCE_BASELINE_VERSION,
      wireStatus: 'not-adopted' as const,
      ref: this.descriptor.ref,
      requestId: this.descriptor.requestId,
      interestId: this.descriptor.interestId,
      bundleId: this.descriptor.bundleId,
      purpose: this.descriptor.purpose,
      entryId,
      transferId: block.descriptor.transferId,
      block: locator.block,
      pageIndex,
      pageCount: block.pageCount,
      byteOffset,
    });
    const source = block.bytes.subarray(byteOffset, byteOffset + length);
    try {
      const metadataBytes = measuredBytes(this.trusted.sizer.measureMetadataBytes(header), 'page metadata bytes');
      if (metadataBytes > this.trusted.limits.metadataBytesMax)
        throw new RangeError('Baseline page metadata exceeds its limit.');
      const bytes = measuredBytes(
        this.trusted.sizer.measureReliableMessageBytes(header, source),
        'page reliable bytes',
      );
      if (bytes > this.trusted.limits.reliableMessageBytesMax)
        throw new RangeError('Baseline page exceeds the reliable message limit.');
      const lease = queue.reserve(bytes);
      if (!lease) return null;
      try {
        const page = Object.freeze({ ...header, bytes: new Uint8Array(source) });
        this.materialized.add(marker);
        let settled = false;
        return Object.freeze({
          page,
          settle: () => {
            if (settled) return;
            settled = true;
            this.materialized.delete(marker);
            lease.release();
          },
        });
      } catch (error) {
        lease.release();
        throw error;
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.entries = null;
    this.unregister();
    this.releaseOwned();
  }

  private assertSendQueue(queue: BaselineReferenceSendQueue): void {
    if (queue.limitBytes > this.trusted.limits.sendQueueBytesMax) {
      this.close();
      throw new RangeError('Baseline send queue exceeds the trusted limit.');
    }
  }
}

class PublicationQueue implements BaselineReferencePublicationQueue {
  private readonly queue: PublishedBundle[] = [];
  private nextBundleId: number;
  private nextTransferId: number;
  private readonly maxQueuedDescriptors: number;
  private closed = false;

  constructor(options: Readonly<{ startBundleId?: number; startTransferId?: number; maxQueuedDescriptors?: number }>) {
    this.nextBundleId = referenceIdentifier(options.startBundleId ?? 0, 'startBundleId');
    this.nextTransferId = referenceIdentifier(options.startTransferId ?? 0, 'startTransferId');
    this.maxQueuedDescriptors = referenceIdentifier(
      options.maxQueuedDescriptors ?? NETWORK_REFERENCE_BASELINE_PUBLICATION_QUEUE_MAX,
      'maxQueuedDescriptors',
      1,
    );
    if (this.maxQueuedDescriptors > NETWORK_REFERENCE_BASELINE_PUBLICATION_QUEUE_MAX)
      throw new RangeError('Publication queue exceeds the reference descriptor limit.');
  }

  publish(value: PreparedBaselineBundleReference): PublishedBaselineBundleReference {
    if (!(value instanceof PreparedBaselineBundle))
      throw new TypeError('Publication requires a local prepared bundle.');
    if (this.closed || this.queue.length >= this.maxQueuedDescriptors) {
      value.discardIfUnpublished();
      throw new Error(this.closed ? 'Baseline publication queue is closed.' : 'Baseline publication queue is full.');
    }
    const entries = value.takeForPublication();
    try {
      const bundleId = this.allocateBundleId();
      const publishedEntries = this.publishEntries(entries, value);
      const descriptor = this.createDescriptor(value, publishedEntries, bundleId);
      const result = new PublishedBundle(
        descriptor,
        publishedEntries,
        value.totalPages,
        value.trusted,
        () => value.releaseFromPublication(),
        () => this.remove(result),
      );
      this.queue.push(result);
      return result;
    } catch (error) {
      value.releaseFromPublication();
      throw error;
    }
  }

  takeDescriptor(queue: BaselineReferenceSendQueue): BaselineDescriptorLease | null {
    const next = this.queue[0];
    if (!next) return null;
    const lease = next.takeDescriptor(queue);
    if (lease) this.remove(next);
    return lease;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const pending = this.queue.splice(0);
    pending.forEach((bundle) => bundle.close());
  }

  diagnostics() {
    return Object.freeze({
      queuedDescriptors: this.queue.length,
      closed: this.closed,
      bundleIdHighWatermark: this.nextBundleId - 1,
    });
  }

  private publishEntries(entries: BaselineOwnedEntry[], prepared: PreparedBaselineBundle): PublishedEntry[] {
    return entries.map((entry) => ({
      ...entry,
      blocks: entry.blocks.map((block) => ({
        ...block,
        descriptor: Object.freeze({
          name: block.name,
          transferId: this.allocateTransferId(),
          elementType: block.elementType,
          elementCount: NETWORK_REFERENCE_BASELINE_CELL_COUNT,
          byteLength: block.bytes.byteLength,
          referencePagePayloadBytes: prepared.trusted.referencePagePayloadBytes,
          pageCount: block.pageCount,
          sha256: block.sha256,
        }),
      })) as [PublishedBlock, PublishedBlock],
    }));
  }

  private createDescriptor(
    prepared: PreparedBaselineBundle,
    entries: PublishedEntry[],
    bundleId: number,
  ): BaselineBundleDescriptorReference {
    return validateBaselineDescriptor(
      {
        kind: 'baseline-bundle-descriptor-reference',
        projectionVersion: NETWORK_REFERENCE_BASELINE_VERSION,
        wireStatus: 'not-adopted',
        ref: prepared.trusted.ref,
        requestId: prepared.trusted.requestId,
        interestId: prepared.trusted.interestId,
        bundleId,
        purpose: prepared.trusted.expectedCapture.purpose,
        key: prepared.trusted.expectedCapture.key,
        minimumRevision: prepared.trusted.minimumRevision,
        authorityCheckpoint: prepared.checkpoint,
        entries: entries.map((entry, entryId) => ({
          entryId,
          role: entry.role,
          key: entry.key,
          chunkRevision: entry.chunkRevision,
          generatorVersion: entry.generatorVersion,
          blocks: entry.blocks.map((block) => block.descriptor),
        })),
      },
      prepared.trusted,
    );
  }

  private remove(bundle: PublishedBundle): void {
    const index = this.queue.indexOf(bundle);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private allocateBundleId(): number {
    if (!Number.isSafeInteger(this.nextBundleId)) throw new RangeError('Baseline bundleId overflowed.');
    return this.nextBundleId++;
  }

  private allocateTransferId(): number {
    if (!Number.isSafeInteger(this.nextTransferId)) throw new RangeError('Baseline transferId overflowed.');
    return this.nextTransferId++;
  }
}

export function createBaselineReferencePublicationQueue(
  options: Readonly<{ startBundleId?: number; startTransferId?: number; maxQueuedDescriptors?: number }> = {},
): BaselineReferencePublicationQueue {
  return new PublicationQueue(options);
}
