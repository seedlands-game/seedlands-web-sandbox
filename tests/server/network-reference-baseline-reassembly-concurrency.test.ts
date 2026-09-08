import { describe, expect, it } from 'vitest';
import { createBaselineReferenceReassembler } from '../../packages/game-core/src/server/protocol/network-reference-baseline-reassembly';
import {
  createBarrierDigest,
  createBaselineDescriptor,
  createConcurrencyLedger,
  createConcurrencyReassemblerOptions,
  pagesFor,
  totalBlockBytes,
  withPage,
} from './support/network-reference-baseline-concurrency-fixture';

describe('network baseline reassembly concurrency', () => {
  it('finishes concurrent final transfers exactly once and releases the mesh reservation', async () => {
    const digest = createBarrierDigest();
    const ledger = createConcurrencyLedger();
    const reassembler = createBaselineReferenceReassembler(createConcurrencyReassemblerOptions(digest, ledger));
    const descriptor = createBaselineDescriptor('mesh', 0);
    reassembler.acceptDescriptor(descriptor);

    const arrivals = pagesFor(descriptor).map((page) => reassembler.acceptPage(page));
    await digest.waitForStarted(54);
    expect(reassembler.diagnostics()).toMatchObject({
      activeBundles: 1,
      digestingTransfers: 54,
      reservedBlockBytes: totalBlockBytes(descriptor),
    });
    expect(ledger.diagnostics().reservedBytes).toBe(totalBlockBytes(descriptor));

    digest.release();
    const results = await Promise.all(arrivals);
    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(results.find((result) => result !== null)).toMatchObject({
      descriptor: { bundleId: 0 },
      entries: { length: 27 },
    });
    expect(reassembler.diagnostics()).toMatchObject({ activeBundles: 0, digestingTransfers: 0, reservedBlockBytes: 0 });
    expect(ledger.diagnostics().reservedBytes).toBe(0);
  });

  it('keeps a collision reservation until every started digest settles during cancel and close', async () => {
    const cancelDigest = createBarrierDigest();
    const cancelLedger = createConcurrencyLedger();
    const cancelling = createBaselineReferenceReassembler(
      createConcurrencyReassemblerOptions(cancelDigest, cancelLedger),
    );
    const cancelDescriptor = createBaselineDescriptor('collision-resync', 0);
    cancelling.acceptDescriptor(cancelDescriptor);
    const cancelArrival = cancelling.acceptPage(pagesFor(cancelDescriptor)[0]!);
    await cancelDigest.waitForStarted(1);
    const cancellation = cancelling.cancel(cancelDescriptor.bundleId);
    await Promise.resolve();
    expect(cancelling.diagnostics()).toMatchObject({
      activeBundles: 1,
      digestingTransfers: 1,
      reservedBlockBytes: totalBlockBytes(cancelDescriptor),
    });
    expect(cancelLedger.diagnostics().reservedBytes).toBe(totalBlockBytes(cancelDescriptor));
    cancelDigest.release();
    await expect(cancellation).resolves.toBe('cancelled');
    await expect(cancelArrival).resolves.toBeNull();
    expect(cancelLedger.diagnostics().reservedBytes).toBe(0);

    const closeDigest = createBarrierDigest();
    const closeLedger = createConcurrencyLedger();
    const closing = createBaselineReferenceReassembler(createConcurrencyReassemblerOptions(closeDigest, closeLedger));
    const closeDescriptor = createBaselineDescriptor('collision-resync', 0);
    closing.acceptDescriptor(closeDescriptor);
    const closeArrival = closing.acceptPage(pagesFor(closeDescriptor)[0]!);
    await closeDigest.waitForStarted(1);
    const close = closing.close();
    await Promise.resolve();
    expect(closing.diagnostics()).toMatchObject({
      activeBundles: 1,
      digestingTransfers: 1,
      reservedBlockBytes: totalBlockBytes(closeDescriptor),
    });
    expect(closeLedger.diagnostics().reservedBytes).toBe(totalBlockBytes(closeDescriptor));
    closeDigest.release();
    await expect(close).resolves.toBeUndefined();
    await expect(closeArrival).resolves.toBeNull();
    expect(closeLedger.diagnostics().reservedBytes).toBe(0);
  });

  it('does not release an active digest reservation early when a related malformed page clears the bundle', async () => {
    const digest = createBarrierDigest();
    const ledger = createConcurrencyLedger();
    const reassembler = createBaselineReferenceReassembler(createConcurrencyReassemblerOptions(digest, ledger));
    const descriptor = createBaselineDescriptor('collision-resync', 0);
    reassembler.acceptDescriptor(descriptor);
    const pages = pagesFor(descriptor);
    const accepted = reassembler.acceptPage(pages[0]!);
    await digest.waitForStarted(1);
    const malformed = reassembler.acceptPage(withPage(pages[1]!, { transferId: 999_999 }));
    await Promise.resolve();
    expect(reassembler.diagnostics()).toMatchObject({
      activeBundles: 1,
      digestingTransfers: 1,
      reservedBlockBytes: totalBlockBytes(descriptor),
    });
    expect(ledger.diagnostics().reservedBytes).toBe(totalBlockBytes(descriptor));
    digest.release();
    await expect(malformed).rejects.toThrow('Baseline page transfer identity is invalid.');
    await expect(accepted).resolves.toBeNull();
    expect(reassembler.diagnostics()).toMatchObject({ activeBundles: 0, digestingTransfers: 0, reservedBlockBytes: 0 });
    expect(ledger.diagnostics().reservedBytes).toBe(0);
  });

  it('associates an extra-field page by its valid bundle before shape rejection and waits for its digest', async () => {
    const digest = createBarrierDigest();
    const ledger = createConcurrencyLedger();
    const reassembler = createBaselineReferenceReassembler(createConcurrencyReassemblerOptions(digest, ledger));
    const descriptor = createBaselineDescriptor('collision-resync', 0);
    reassembler.acceptDescriptor(descriptor);
    const pages = pagesFor(descriptor);
    const accepted = reassembler.acceptPage(pages[0]!);
    await digest.waitForStarted(1);
    const relatedButExtra = Object.assign({}, pages[1]!, { [Symbol('extra-page-field')]: true });
    const malformed = reassembler.acceptPage(relatedButExtra as never);
    let malformedSettled = false;
    void malformed.then(
      () => {
        malformedSettled = true;
      },
      () => {
        malformedSettled = true;
      },
    );
    await Promise.resolve();
    expect(malformedSettled).toBe(false);
    expect(reassembler.diagnostics()).toMatchObject({
      activeBundles: 1,
      digestingTransfers: 1,
      reservedBlockBytes: totalBlockBytes(descriptor),
    });
    expect(ledger.diagnostics().reservedBytes).toBe(totalBlockBytes(descriptor));

    digest.release();
    await expect(malformed).rejects.toThrow('baseline page contains unknown or missing fields.');
    await expect(accepted).resolves.toBeNull();
    expect(reassembler.diagnostics()).toMatchObject({ activeBundles: 0, digestingTransfers: 0, reservedBlockBytes: 0 });
    expect(ledger.diagnostics().reservedBytes).toBe(0);
  });

  it('does not let unassociated or unknown pages clear any active bundle', async () => {
    const ledger = createConcurrencyLedger();
    const reassembler = createBaselineReferenceReassembler(
      createConcurrencyReassemblerOptions(
        {
          algorithm: 'sha-256',
          digest: async (bytes) => {
            const { createHash } = await import('node:crypto');
            return createHash('sha256').update(bytes).digest('hex');
          },
        },
        ledger,
      ),
    );
    const first = createBaselineDescriptor('collision-resync', 0);
    const second = createBaselineDescriptor('collision-resync', 1);
    reassembler.acceptDescriptor(first);
    reassembler.acceptDescriptor(second);
    const bothBytes = totalBlockBytes(first) + totalBlockBytes(second);
    expect(ledger.diagnostics().reservedBytes).toBe(bothBytes);

    const secondPage = pagesFor(second)[0]!;
    await expect(
      reassembler.acceptPage(withPage(secondPage, { ref: { ...secondPage.ref, epoch: 'wrong-epoch' } })),
    ).rejects.toThrow('Baseline page does not match its descriptor.');
    expect(reassembler.diagnostics()).toMatchObject({ activeBundles: 2, reservedBlockBytes: bothBytes });
    expect(ledger.diagnostics().reservedBytes).toBe(bothBytes);

    const unknown = withPage(pagesFor(first)[0]!, { bundleId: 999 });
    await expect(reassembler.acceptPage(unknown)).rejects.toThrow('Baseline page has no active descriptor.');
    expect(reassembler.diagnostics()).toMatchObject({ activeBundles: 2, reservedBlockBytes: bothBytes });
    expect(ledger.diagnostics().reservedBytes).toBe(bothBytes);
    await expect(reassembler.cancel(first.bundleId)).resolves.toBe('cancelled');
    await expect(reassembler.cancel(second.bundleId)).resolves.toBe('cancelled');
    expect(ledger.diagnostics().reservedBytes).toBe(0);
  });
});
