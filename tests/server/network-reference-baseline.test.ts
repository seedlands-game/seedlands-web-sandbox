import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authorityBaselineCaptureKeys } from '../../packages/game-core/src/server/authority/authority-baseline-capture';
import type { AuthorityBaselineCaptureResult } from '../../packages/game-core/src/server/authority/authority-baseline-capture-types';
import {
  createBaselineReferencePublicationQueue,
  prepareAuthorityBaselineReference,
} from '../../packages/game-core/src/server/protocol/network-reference-baseline';
import {
  createBaselineReferenceInFlightLedger,
  createBaselineReferenceSendQueue,
} from '../../packages/game-core/src/server/protocol/network-reference-baseline-budget';
import {
  BASELINE_QUEUE_BYTES,
  DeferredDigest,
  baselineRef,
  collisionCapture,
  context,
  flushDigestTurns,
} from './support/network-reference-baseline-publication-fixture';

const sha256 = Object.freeze({
  algorithm: 'sha-256' as const,
  digest: async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex'),
});

function meshCapture(captureId = 34) {
  const key = '2,3,4';
  const keys = authorityBaselineCaptureKeys({ captureId, purpose: 'mesh', key, minimumRevision: 5 });
  const orderedKeys = [key, ...keys.filter((candidate) => candidate !== key)];
  return {
    status: 'available' as const,
    captureId,
    captureGeneration: 6,
    purpose: 'mesh' as const,
    key,
    checkpoint: { epoch: baselineRef.epoch, physicsTick: 8, commitSequence: 9, worldRevision: 10 },
    entries: orderedKeys.map((entryKey, index) => ({
      role: (index === 0 ? 'main' : 'overlay') as 'main' | 'overlay',
      key: entryKey,
      chunkRevision: index === 0 ? 5 : index,
      generatorVersion: 1,
      canonical: new Uint16Array(32 ** 3).buffer,
      fluid: new Uint8Array(32 ** 3).buffer,
    })),
  } satisfies AuthorityBaselineCaptureResult;
}

function malformedCapture(value: unknown): AuthorityBaselineCaptureResult {
  return value as AuthorityBaselineCaptureResult;
}

describe('network baseline reference projection', () => {
  it('copies canonical values as little-endian bytes before publishing immutable metadata', async () => {
    const capture = collisionCapture(20);
    new Uint16Array(capture.entries[0].canonical)[0] = 0x0102;
    capture.entries[0].fluid = new Uint8Array(32 ** 3).fill(7).buffer;
    const inFlight = createBaselineReferenceInFlightLedger(16 * 1024 * 1024);
    const prepared = await prepareAuthorityBaselineReference(capture, context(capture, sha256, inFlight));
    if (!('publish' in prepared)) throw new Error('Expected an available reference.');

    new Uint16Array(capture.entries[0].canonical)[0] = 0xffff;
    new Uint8Array(capture.entries[0].fluid)[0] = 99;
    const publication = createBaselineReferencePublicationQueue();
    const published = prepared.publish(publication);
    const send = createBaselineReferenceSendQueue(BASELINE_QUEUE_BYTES);
    const descriptorLease = publication.takeDescriptor(send)!;
    expect(Object.isFrozen(descriptorLease.descriptor)).toBe(true);
    expect(Object.isFrozen(descriptorLease.descriptor.entries[0]!.blocks)).toBe(true);
    descriptorLease.settle();

    const canonical = published.materializePage({ entryId: 0, block: 'canonical', pageIndex: 0 }, send)!;
    const fluid = published.materializePage({ entryId: 0, block: 'fluid', pageIndex: 0 }, send)!;
    expect([...canonical.page.bytes.slice(0, 2)]).toEqual([0x02, 0x01]);
    expect(fluid.page.bytes[0]).toBe(7);
    expect(descriptorLease.descriptor.entries[0]!.blocks[0].sha256).toBe(
      createHash('sha256')
        .update(Buffer.concat([Buffer.from([0x02, 0x01]), Buffer.alloc(65_534)]))
        .digest('hex'),
    );
    canonical.settle();
    fluid.settle();
    published.close();
    expect(inFlight.diagnostics().reservedBytes).toBe(0);
  });

  it.each(['cancelled', 'not-available', 'residency-pressure', 'superseded', 'stopping'] as const)(
    'preserves the Authority unavailable reason %s without starting a digest',
    async (reason) => {
      let digestCalls = 0;
      const capture: AuthorityBaselineCaptureResult = {
        status: 'unavailable',
        captureId: 7,
        captureGeneration: 9,
        purpose: 'collision-resync',
        key: '0,1,0',
        reason,
      };
      const projected = await prepareAuthorityBaselineReference(capture, {
        ...context(collisionCapture(7)),
        expectedCapture: {
          captureId: 7,
          captureGeneration: 9,
          purpose: 'collision-resync',
          key: '0,1,0',
          generatorVersion: 1,
        },
        digest: { algorithm: 'sha-256', digest: async () => ((digestCalls += 1), 'a'.repeat(64)) },
      });
      expect(projected).toMatchObject({ kind: 'baseline-unavailable-reference', reason, ref: baselineRef });
      expect(digestCalls).toBe(0);
    },
  );

  it('rejects mismatched capture identity, checkpoint epoch, and extension fields', async () => {
    const capture = collisionCapture(30);
    await expect(
      prepareAuthorityBaselineReference(capture, {
        ...context(capture),
        expectedCapture: { ...context(capture).expectedCapture, captureGeneration: 999 },
      }),
    ).rejects.toThrow(/identity/i);
    await expect(
      prepareAuthorityBaselineReference(
        { ...capture, checkpoint: { ...capture.checkpoint, epoch: 'wrong' } },
        context(capture),
      ),
    ).rejects.toThrow(/epoch/i);
    await expect(
      prepareAuthorityBaselineReference(
        { ...capture, extension: true } as unknown as AuthorityBaselineCaptureResult,
        context(capture),
      ),
    ).rejects.toThrow(/unknown or missing fields/i);
  });

  it('applies the page-count gate before copying or hashing large blocks', async () => {
    const capture = collisionCapture(31);
    let digestCalls = 0;
    const projected = await prepareAuthorityBaselineReference(capture, {
      ...context(capture),
      referencePagePayloadBytes: 1,
      pagesPerBundleMax: 512,
      digest: { algorithm: 'sha-256', digest: async () => ((digestCalls += 1), 'a'.repeat(64)) },
    });
    expect(projected).toMatchObject({ kind: 'baseline-unavailable-reference', reason: 'transfer-limit' });
    expect(digestCalls).toBe(0);
  });

  it('projects the complete main plus 26 overlay mesh capture in canonical order', async () => {
    const capture = meshCapture();
    const orderedKeys = capture.entries.map((entry) => entry.key);
    const prepared = await prepareAuthorityBaselineReference(capture, {
      ...context(collisionCapture(capture.captureId), sha256),
      interestId: 77,
      expectedCapture: {
        captureId: capture.captureId,
        captureGeneration: 6,
        purpose: 'mesh',
        key: capture.key,
        generatorVersion: 1,
      },
      minimumRevision: 5,
      referencePagePayloadBytes: 65_536,
      pagesPerBundleMax: 54,
    });
    if (!('publish' in prepared)) throw new Error('Expected a complete mesh reference.');
    const publication = createBaselineReferencePublicationQueue();
    const published = prepared.publish(publication);
    expect(published.pageCount).toBe(54);
    expect(published.descriptor.entries.map((entry) => entry.key)).toEqual(orderedKeys);
    expect(published.descriptor.entries.map((entry) => entry.role)).toEqual([
      'main',
      ...Array.from({ length: 26 }, () => 'overlay'),
    ]);
    published.close();
  });

  it.each([
    {
      label: 'expected purpose',
      create: () => {
        const capture = collisionCapture(41);
        return {
          capture,
          input: {
            ...context(capture),
            interestId: 1,
            expectedCapture: { ...context(capture).expectedCapture, purpose: 'mesh' as const },
          },
        };
      },
    },
    {
      label: 'expected key',
      create: () => {
        const capture = collisionCapture(42);
        return {
          capture,
          input: { ...context(capture), expectedCapture: { ...context(capture).expectedCapture, key: '1,1,1' } },
        };
      },
    },
    {
      label: 'generatorVersion',
      create: () => {
        const capture = collisionCapture(43);
        return {
          capture,
          input: {
            ...context(capture),
            expectedCapture: { ...context(capture).expectedCapture, generatorVersion: 2 },
          },
        };
      },
    },
    {
      label: 'minimumRevision',
      create: () => {
        const capture = collisionCapture(44);
        return { capture, input: { ...context(capture), minimumRevision: 1 } };
      },
    },
    {
      label: 'duplicate buffer',
      create: () => {
        const capture = meshCapture(45);
        const entries = capture.entries.map((entry) => ({ ...entry }));
        entries[1]!.canonical = entries[0]!.canonical;
        return {
          capture: malformedCapture({ ...capture, entries }),
          input: {
            ...context(collisionCapture(45)),
            interestId: 1,
            expectedCapture: {
              captureId: 45,
              captureGeneration: 6,
              purpose: 'mesh' as const,
              key: capture.key,
              generatorVersion: 1,
            },
            minimumRevision: 5,
          },
        };
      },
    },
    {
      label: 'wrong length',
      create: () => {
        const capture = collisionCapture(46);
        const entries = [{ ...capture.entries[0], canonical: capture.entries[0].canonical.slice(0, 2) }];
        return { capture: malformedCapture({ ...capture, entries }), input: context(capture) };
      },
    },
    {
      label: 'wrong role',
      create: () => {
        const capture = collisionCapture(47);
        const entries = [{ ...capture.entries[0], role: 'main' }];
        return { capture: malformedCapture({ ...capture, entries }), input: context(capture) };
      },
    },
    {
      label: 'wrong order',
      create: () => {
        const capture = meshCapture(48);
        const entries = capture.entries.map((entry) => ({ ...entry }));
        [entries[1], entries[2]] = [entries[2]!, entries[1]!];
        return {
          capture: malformedCapture({ ...capture, entries }),
          input: {
            ...context(collisionCapture(48)),
            interestId: 1,
            expectedCapture: {
              captureId: 48,
              captureGeneration: 6,
              purpose: 'mesh' as const,
              key: capture.key,
              generatorVersion: 1,
            },
            minimumRevision: 5,
          },
        };
      },
    },
  ])('rejects invalid $label before hashing block contents', async ({ create }) => {
    const { capture, input } = create();
    let digestCalls = 0;
    await expect(
      prepareAuthorityBaselineReference(capture, {
        ...input,
        digest: { algorithm: 'sha-256', digest: async () => ((digestCalls += 1), 'a'.repeat(64)) },
      }),
    ).rejects.toThrow();
    expect(digestCalls).toBe(0);
  });

  it.each([
    { label: 'transfer', transferBytes: 65_535, inFlightBytes: 98_304 },
    { label: 'in-flight', transferBytes: 65_536, inFlightBytes: 98_303 },
  ])(
    'returns transfer-limit before hashing when the $label budget is too low',
    async ({ transferBytes, inFlightBytes }) => {
      const capture = collisionCapture(49);
      let digestCalls = 0;
      const inFlight = createBaselineReferenceInFlightLedger(inFlightBytes);
      const projected = await prepareAuthorityBaselineReference(capture, {
        ...context(capture),
        limits: {
          ...context(capture).limits,
          baselineTransferBytesMax: transferBytes,
          baselineInFlightBytesMax: inFlightBytes,
        },
        inFlight,
        digest: { algorithm: 'sha-256', digest: async () => ((digestCalls += 1), 'a'.repeat(64)) },
      });
      expect(projected).toMatchObject({ kind: 'baseline-unavailable-reference', reason: 'transfer-limit' });
      expect(digestCalls).toBe(0);
      expect(inFlight.diagnostics().reservedBytes).toBe(0);
    },
  );

  it('cleans the owned reservation when descriptor metadata or a complete page exceeds its sizer limit', async () => {
    const metadataCapture = collisionCapture(50);
    const metadataLedger = createBaselineReferenceInFlightLedger(16 * 1024 * 1024);
    const metadataPrepared = await prepareAuthorityBaselineReference(metadataCapture, {
      ...context(metadataCapture, sha256, metadataLedger),
      sizer: {
        measureMetadataBytes: () => 64 * 1024 + 1,
        measureReliableMessageBytes: (_metadata, bytes) => bytes.byteLength,
      },
    });
    if (!('publish' in metadataPrepared)) throw new Error('Expected a prepared metadata fixture.');
    expect(() => metadataPrepared.publish(createBaselineReferencePublicationQueue())).toThrow(/metadata/i);
    expect(metadataLedger.diagnostics().reservedBytes).toBe(0);

    const pageCapture = collisionCapture(51);
    const pageLedger = createBaselineReferenceInFlightLedger(16 * 1024 * 1024);
    const pagePrepared = await prepareAuthorityBaselineReference(pageCapture, {
      ...context(pageCapture, sha256, pageLedger),
      sizer: {
        measureMetadataBytes: () => 32,
        measureReliableMessageBytes: (metadata, bytes) =>
          (metadata as { kind?: unknown }).kind === 'baseline-page-reference' ? 1024 * 1024 + 1 : bytes.byteLength + 32,
      },
    });
    if (!('publish' in pagePrepared)) throw new Error('Expected a prepared page fixture.');
    const publication = createBaselineReferencePublicationQueue();
    const published = pagePrepared.publish(publication);
    const send = createBaselineReferenceSendQueue(BASELINE_QUEUE_BYTES);
    publication.takeDescriptor(send)!.settle();
    expect(() => published.materializePage({ entryId: 0, block: 'canonical', pageIndex: 0 }, send)).toThrow(
      /reliable message limit/i,
    );
    expect(pageLedger.diagnostics().reservedBytes).toBe(0);
    expect(send.diagnostics().reservedBytes).toBe(0);
  });

  it('waits for a sibling digest after another digest rejects before releasing bytes', async () => {
    const capture = collisionCapture(52);
    const digest = new DeferredDigest();
    const inFlight = createBaselineReferenceInFlightLedger(16 * 1024 * 1024);
    const pending = prepareAuthorityBaselineReference(capture, context(capture, digest, inFlight));
    await flushDigestTurns();
    expect(digest.pending).toHaveLength(2);
    digest.pending.splice(0, 1)[0]!.reject(new Error('controlled digest failure'));
    await flushDigestTurns();
    expect(inFlight.diagnostics().reservedBytes).toBe(98_304);
    let settled = false;
    void pending
      .finally(() => {
        settled = true;
      })
      .catch(() => {});
    await flushDigestTurns();
    expect(settled).toBe(false);

    digest.release();
    await expect(pending).rejects.toThrow('controlled digest failure');
    expect(inFlight.diagnostics().reservedBytes).toBe(0);
  });

  it('waits for every started digest before an abort releases the owned-block reservation', async () => {
    const capture = collisionCapture(32);
    const digest = new DeferredDigest();
    const inFlight = createBaselineReferenceInFlightLedger(16 * 1024 * 1024);
    const controller = new AbortController();
    const pending = prepareAuthorityBaselineReference(capture, context(capture, digest, inFlight), {
      signal: controller.signal,
    });
    await flushDigestTurns();
    expect(digest.pending).toHaveLength(2);
    expect(inFlight.diagnostics().reservedBytes).toBe(98_304);
    controller.abort();
    let settled = false;
    void pending
      .finally(() => {
        settled = true;
      })
      .catch(() => {});
    await flushDigestTurns();
    expect(settled).toBe(false);
    expect(inFlight.diagnostics().reservedBytes).toBe(98_304);

    digest.release();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(inFlight.diagnostics().reservedBytes).toBe(0);
  });

  it('safely rejects publishing an already-owned draft into another queue', async () => {
    const capture = collisionCapture(33);
    const inFlight = createBaselineReferenceInFlightLedger(16 * 1024 * 1024);
    const prepared = await prepareAuthorityBaselineReference(capture, context(capture, sha256, inFlight));
    if (!('publish' in prepared)) throw new Error('Expected an available reference.');
    const firstQueue = createBaselineReferencePublicationQueue();
    const published = prepared.publish(firstQueue);
    const otherQueue = createBaselineReferencePublicationQueue();
    expect(() => prepared.publish(otherQueue)).toThrow(/no longer publishable/i);
    expect(inFlight.diagnostics().reservedBytes).toBe(98_304);
    const closedQueue = createBaselineReferencePublicationQueue();
    closedQueue.close();
    expect(() => prepared.publish(closedQueue)).toThrow(/closed/i);
    expect(inFlight.diagnostics().reservedBytes).toBe(98_304);

    const send = createBaselineReferenceSendQueue(BASELINE_QUEUE_BYTES);
    const descriptor = firstQueue.takeDescriptor(send)!;
    descriptor.settle();
    const page = published.materializePage({ entryId: 0, block: 'canonical', pageIndex: 0 }, send);
    expect(page?.page.bytes.byteLength).toBe(1024);
    page?.settle();
    published.close();
    expect(inFlight.diagnostics().reservedBytes).toBe(0);
  });
});
