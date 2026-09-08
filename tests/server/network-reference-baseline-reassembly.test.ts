import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createBaselineReferencePublicationQueue,
  prepareAuthorityBaselineReference,
  type BaselineBundleDescriptorReference,
  type BaselinePageReference,
  type PublishedBaselineBundleReference,
} from '../../packages/game-core/src/server/protocol/network-reference-baseline';
import {
  createBaselineReferenceInFlightLedger,
  createBaselineReferenceSendQueue,
} from '../../packages/game-core/src/server/protocol/network-reference-baseline-budget';
import { createBaselineReferenceReassembler } from '../../packages/game-core/src/server/protocol/network-reference-baseline-reassembly';
import {
  BASELINE_QUEUE_BYTES,
  baselineRef,
  collisionCapture,
  context,
} from './support/network-reference-baseline-publication-fixture';

const digest = Object.freeze({
  algorithm: 'sha-256' as const,
  digest: async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex'),
});
const sizer = Object.freeze({
  measureMetadataBytes: () => 64,
  measureReliableMessageBytes: (_metadata: unknown, bytes: Uint8Array) => bytes.byteLength + 128,
});
const limits = Object.freeze({
  metadataBytesMax: 64 * 1024,
  reliableMessageBytesMax: 1024 * 1024,
  baselineTransferBytesMax: 1024 * 1024,
  baselineInFlightBytesMax: 16 * 1024 * 1024,
  sendQueueBytesMax: BASELINE_QUEUE_BYTES,
});

async function publishedFixture(): Promise<{
  descriptor: BaselineBundleDescriptorReference;
  published: PublishedBaselineBundleReference;
  pages: BaselinePageReference[];
}> {
  const capture = collisionCapture(40);
  new Uint16Array(capture.entries[0].canonical).forEach((_value, index, values) => (values[index] = index % 257));
  new Uint8Array(capture.entries[0].fluid).forEach((_value, index, values) => (values[index] = index % 251));
  const prepared = await prepareAuthorityBaselineReference(capture, {
    ...context(capture, digest),
    referencePagePayloadBytes: 8192,
    pagesPerBundleMax: 32,
    sizer,
  });
  if (!('publish' in prepared)) throw new Error('Expected an available baseline.');
  const publication = createBaselineReferencePublicationQueue();
  const published = prepared.publish(publication);
  const send = createBaselineReferenceSendQueue(BASELINE_QUEUE_BYTES);
  const descriptorLease = publication.takeDescriptor(send)!;
  descriptorLease.settle();
  const pages: BaselinePageReference[] = [];
  for (const entry of descriptorLease.descriptor.entries) {
    for (const block of entry.blocks) {
      for (let pageIndex = 0; pageIndex < block.pageCount; pageIndex += 1) {
        const lease = published.materializePage({ entryId: entry.entryId, block: block.name, pageIndex }, send)!;
        pages.push(lease.page);
        lease.settle();
      }
    }
  }
  return { descriptor: descriptorLease.descriptor, published, pages };
}

function createReassembler(inFlight = createBaselineReferenceInFlightLedger(16 * 1024 * 1024)) {
  return {
    inFlight,
    reassembler: createBaselineReferenceReassembler({
      ref: baselineRef,
      limits,
      pagesPerBundleMax: 32,
      digest,
      sizer,
      inFlight,
    }),
  };
}

describe('network baseline reference reassembly', () => {
  it('reassembles out-of-order pages into independently owned canonical LE and fluid blocks', async () => {
    const fixture = await publishedFixture();
    const { reassembler, inFlight } = createReassembler();
    reassembler.acceptDescriptor(fixture.descriptor);
    const results = [];
    for (const page of fixture.pages.slice().reverse()) results.push(await reassembler.acceptPage(page));
    const assembled = results.find((value) => value !== null)!;
    expect(results.filter((value) => value !== null)).toHaveLength(1);
    expect(assembled.descriptor).toEqual(fixture.descriptor);
    expect(assembled.entries).toHaveLength(1);
    expect([...assembled.entries[0]!.canonicalLittleEndian.slice(0, 6)]).toEqual([0, 0, 1, 0, 2, 0]);
    expect([...assembled.entries[0]!.fluid.slice(0, 4)]).toEqual([0, 1, 2, 3]);
    fixture.pages[0]!.bytes.fill(255);
    expect([...assembled.entries[0]!.canonicalLittleEndian.slice(0, 4)]).toEqual([0, 0, 1, 0]);
    expect(inFlight.diagnostics().reservedBytes).toBe(0);
    expect(reassembler.diagnostics()).toMatchObject({ activeBundles: 0, reservedBlockBytes: 0 });
    fixture.published.close();
  });

  it('rejects a page before its descriptor without retaining orphan bytes', async () => {
    const fixture = await publishedFixture();
    const { reassembler, inFlight } = createReassembler();
    await expect(reassembler.acceptPage(fixture.pages[0]!)).rejects.toThrow(/no active descriptor/i);
    expect(inFlight.diagnostics().reservedBytes).toBe(0);
    fixture.published.close();
  });

  it('fails the whole active bundle on duplicate page or block hash mismatch', async () => {
    const duplicateFixture = await publishedFixture();
    const duplicate = createReassembler();
    duplicate.reassembler.acceptDescriptor(duplicateFixture.descriptor);
    await expect(duplicate.reassembler.acceptPage(duplicateFixture.pages[0]!)).resolves.toBeNull();
    await expect(duplicate.reassembler.acceptPage(duplicateFixture.pages[0]!)).rejects.toThrow(/duplicated/i);
    expect(duplicate.inFlight.diagnostics().reservedBytes).toBe(0);
    duplicateFixture.published.close();

    const hashFixture = await publishedFixture();
    const failed = createReassembler();
    failed.reassembler.acceptDescriptor(hashFixture.descriptor);
    hashFixture.pages[0]!.bytes[0] ^= 0xff;
    const outcomes = await Promise.allSettled(hashFixture.pages.map((page) => failed.reassembler.acceptPage(page)));
    expect(outcomes.some((outcome) => outcome.status === 'rejected' && /hash/i.test(String(outcome.reason)))).toBe(
      true,
    );
    expect(failed.inFlight.diagnostics().reservedBytes).toBe(0);
    hashFixture.published.close();
  });

  it('copies the descriptor and rejects sparse or extended shapes before allocation', async () => {
    const fixture = await publishedFixture();
    const { reassembler, inFlight } = createReassembler();
    const mutable = {
      ...fixture.descriptor,
      ref: { ...fixture.descriptor.ref },
      authorityCheckpoint: { ...fixture.descriptor.authorityCheckpoint },
      entries: fixture.descriptor.entries.map((entry) => ({
        ...entry,
        blocks: entry.blocks.map((block) => ({ ...block })),
      })),
    };
    reassembler.acceptDescriptor(mutable);
    mutable.entries[0]!.key = '9,9,9';
    await expect(reassembler.cancel(fixture.descriptor.bundleId)).resolves.toBe('cancelled');

    const extended = { ...fixture.descriptor, extension: true };
    expect(() => reassembler.acceptDescriptor(extended)).toThrow(/unknown or missing fields/i);
    const sparse = {
      ...fixture.descriptor,
      entries: fixture.descriptor.entries.map((entry) => ({ ...entry })),
    };
    delete sparse.entries[0];
    expect(() => reassembler.acceptDescriptor(sparse)).toThrow(/dense/i);
    expect(inFlight.diagnostics().reservedBytes).toBe(0);
    fixture.published.close();
  });

  it('does not advance bundle high-water when capacity rejects a descriptor', async () => {
    const fixture = await publishedFixture();
    const inFlight = createBaselineReferenceInFlightLedger(16 * 1024 * 1024);
    const occupied = inFlight.reserve(16 * 1024 * 1024)!;
    const { reassembler } = createReassembler(inFlight);
    const rejectedHighId = { ...fixture.descriptor, bundleId: 100 };
    expect(() => reassembler.acceptDescriptor(rejectedHighId)).toThrow(/no in-flight capacity/i);
    expect(reassembler.diagnostics().bundleIdHighWatermark).toBe(-1);

    occupied.release();
    expect(() => reassembler.acceptDescriptor(fixture.descriptor)).not.toThrow();
    await expect(reassembler.cancel(fixture.descriptor.bundleId)).resolves.toBe('cancelled');
    expect(inFlight.diagnostics().reservedBytes).toBe(0);
    fixture.published.close();
  });
});
