import { describe, expect, it } from 'vitest';
import {
  createBaselineReferenceInFlightLedger,
  createBaselineReferenceSendQueue,
} from '../../src/server/protocol/network-reference-baseline-budget';
import {
  createBaselineReferencePublicationQueue,
  prepareAuthorityBaselineReference,
} from '../../src/server/protocol/network-reference-baseline';
import {
  BASELINE_QUEUE_BYTES,
  DeferredDigest,
  collisionCapture,
  context,
  immediateDigest,
  flushDigestTurns,
  prepareAvailable,
} from './support/network-reference-baseline-publication-fixture';

describe('baseline reference publication', () => {
  it('4MiB send queue 满时保持 descriptor FIFO，且 descriptor 先于 page 物化', async () => {
    const publication = createBaselineReferencePublicationQueue();
    const first = (await prepareAvailable(collisionCapture(0))).publish(publication);
    const second = (await prepareAvailable(collisionCapture(1))).publish(publication);
    const send = createBaselineReferenceSendQueue(BASELINE_QUEUE_BYTES);
    const occupied = send.reserve(BASELINE_QUEUE_BYTES);
    expect(occupied).not.toBeNull();

    expect(publication.takeDescriptor(send)).toBeNull();
    expect(publication.diagnostics().queuedDescriptors).toBe(2);
    expect(() => first.materializePage({ entryId: 0, block: 'canonical', pageIndex: 0 }, send)).toThrow(/descriptor/i);

    occupied!.release();
    const firstDescriptor = publication.takeDescriptor(send);
    expect(firstDescriptor?.descriptor.bundleId).toBe(0);
    expect(publication.diagnostics().queuedDescriptors).toBe(1);
    firstDescriptor!.settle();
    const page = first.materializePage({ entryId: 0, block: 'canonical', pageIndex: 0 }, send);
    expect(page).not.toBeNull();
    page!.settle();

    const secondDescriptor = publication.takeDescriptor(send);
    expect(secondDescriptor?.descriptor.bundleId).toBe(1);
    secondDescriptor!.settle();
    first.close();
    second.close();
  });

  it('页面是 owned copy，page settle 与 published close 分别结算发送和源预算', async () => {
    const inFlight = createBaselineReferenceInFlightLedger(16 * 1024 * 1024);
    const prepared = await prepareAvailable(collisionCapture(2), { inFlight });
    const publication = createBaselineReferencePublicationQueue();
    const bundle = prepared.publish(publication);
    const send = createBaselineReferenceSendQueue(BASELINE_QUEUE_BYTES);
    const descriptor = publication.takeDescriptor(send)!;
    descriptor.settle();

    const first = bundle.materializePage({ entryId: 0, block: 'canonical', pageIndex: 0 }, send)!;
    const original = first.page.bytes[0]!;
    first.page.bytes[0] = original ^ 0xff;
    expect(send.diagnostics().reservedBytes).toBeGreaterThan(0);
    first.settle();
    const replay = bundle.materializePage({ entryId: 0, block: 'canonical', pageIndex: 0 }, send)!;
    expect(replay.page.bytes[0]).toBe(original);
    const heldPageBytes = send.diagnostics().reservedBytes;
    bundle.close();
    expect(inFlight.diagnostics().reservedBytes).toBe(0);
    expect(send.diagnostics().reservedBytes).toBe(heldPageBytes);
    replay.settle();
    expect(send.diagnostics().reservedBytes).toBe(0);
  });

  it('descriptor 已取走后，发送队列满会延后 page 物化且不泄漏', async () => {
    const inFlight = createBaselineReferenceInFlightLedger(16 * 1024 * 1024);
    const prepared = await prepareAvailable(collisionCapture(20), { inFlight });
    const publication = createBaselineReferencePublicationQueue();
    const bundle = prepared.publish(publication);
    const send = createBaselineReferenceSendQueue(BASELINE_QUEUE_BYTES);
    const descriptor = publication.takeDescriptor(send)!;
    descriptor.settle();
    const sourceBytes = inFlight.diagnostics().reservedBytes;
    const occupied = send.reserve(BASELINE_QUEUE_BYTES)!;
    const locator = { entryId: 0, block: 'canonical' as const, pageIndex: 0 };

    expect(bundle.materializePage(locator, send)).toBeNull();
    expect(inFlight.diagnostics().reservedBytes).toBe(sourceBytes);
    expect(send.diagnostics().reservedBytes).toBe(BASELINE_QUEUE_BYTES);

    occupied.release();
    const first = bundle.materializePage(locator, send)!;
    const original = first.page.bytes[0]!;
    first.page.bytes[0] = original ^ 0xff;
    first.settle();
    const replay = bundle.materializePage(locator, send)!;
    expect(replay.page.bytes[0]).toBe(original);
    replay.settle();
    bundle.close();
    expect(inFlight.diagnostics().reservedBytes).toBe(0);
    expect(send.diagnostics().reservedBytes).toBe(0);
  });

  it('后启动 capture 先准备完成时先取得公开 bundle id', async () => {
    const digest = new DeferredDigest();
    const firstCapture = collisionCapture(3);
    const secondCapture = collisionCapture(4);
    const first = prepareAuthorityBaselineReference(firstCapture, context(firstCapture, digest));
    await flushDigestTurns();
    const second = prepareAuthorityBaselineReference(secondCapture, context(secondCapture, digest));
    await flushDigestTurns();
    expect(digest.pending).toHaveLength(4);

    digest.release(2, 2);
    const preparedSecond = await second;
    if (!('publish' in preparedSecond)) throw new Error('Second capture was unexpectedly unavailable.');
    const publication = createBaselineReferencePublicationQueue();
    const secondBundle = preparedSecond.publish(publication);
    digest.release();
    const preparedFirst = await first;
    if (!('publish' in preparedFirst)) throw new Error('First capture was unexpectedly unavailable.');
    const firstBundle = preparedFirst.publish(publication);

    const send = createBaselineReferenceSendQueue(BASELINE_QUEUE_BYTES);
    const earlier = publication.takeDescriptor(send)!;
    expect(earlier.descriptor.requestId).toBe(4);
    expect(earlier.descriptor.bundleId).toBe(0);
    earlier.settle();
    const later = publication.takeDescriptor(send)!;
    expect(later.descriptor.requestId).toBe(3);
    expect(later.descriptor.bundleId).toBe(1);
    later.settle();
    secondBundle.close();
    firstBundle.close();
  });

  it('首个 await 后 capture checkpoint 被修改也不改变 descriptor，并且 close 不积压 descriptor', async () => {
    const digest = new DeferredDigest();
    const capture = collisionCapture(5);
    const pending = prepareAuthorityBaselineReference(capture, context(capture, digest));
    await flushDigestTurns();
    capture.checkpoint.physicsTick = 999;
    capture.checkpoint.commitSequence = 999;
    capture.checkpoint.worldRevision = 999;
    digest.release();
    const prepared = await pending;
    if (!('publish' in prepared)) throw new Error('Capture was unexpectedly unavailable.');
    const publication = createBaselineReferencePublicationQueue();
    const bundle = prepared.publish(publication);
    expect(bundle.descriptor.authorityCheckpoint).toEqual({ physicsTick: 1, commitSequence: 2, worldRevision: 3 });
    bundle.close();
    expect(publication.diagnostics().queuedDescriptors).toBe(0);
  });

  it('反复 prepare、publish、close 而不 take 时不会积累 queued descriptor 或 source 预算', async () => {
    const inFlight = createBaselineReferenceInFlightLedger(16 * 1024 * 1024);
    const publication = createBaselineReferencePublicationQueue();
    for (let captureId = 6; captureId < 9; captureId += 1) {
      const bundle = (await prepareAvailable(collisionCapture(captureId), { inFlight })).publish(publication);
      expect(publication.diagnostics().queuedDescriptors).toBe(1);
      bundle.close();
      expect(publication.diagnostics().queuedDescriptors).toBe(0);
      expect(inFlight.diagnostics().reservedBytes).toBe(0);
    }
  });

  it('page sizer 失败会释放 published source 预算，不遗留 descriptor', async () => {
    const inFlight = createBaselineReferenceInFlightLedger(16 * 1024 * 1024);
    const capture = collisionCapture(9);
    const prepared = await prepareAuthorityBaselineReference(capture, {
      ...context(capture, immediateDigest, inFlight),
      sizer: {
        measureMetadataBytes: (metadata) => {
          if (
            typeof metadata === 'object' &&
            metadata !== null &&
            'kind' in metadata &&
            metadata.kind === 'baseline-page-reference'
          ) {
            throw new Error('fixture page sizing failed');
          }
          return 32;
        },
        measureReliableMessageBytes: (_metadata, payload) => payload.byteLength + 64,
      },
    });
    if (!('publish' in prepared)) throw new Error('Capture was unexpectedly unavailable.');
    const publication = createBaselineReferencePublicationQueue();
    const bundle = prepared.publish(publication);
    const send = createBaselineReferenceSendQueue(BASELINE_QUEUE_BYTES);
    const descriptor = publication.takeDescriptor(send)!;
    descriptor.settle();
    expect(() => bundle.materializePage({ entryId: 0, block: 'canonical', pageIndex: 0 }, send)).toThrow(/sizing/i);
    expect(inFlight.diagnostics().reservedBytes).toBe(0);
    expect(publication.diagnostics().queuedDescriptors).toBe(0);
    expect(send.diagnostics().reservedBytes).toBe(0);
  });
});
