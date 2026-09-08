import { describe, expect, it } from 'vitest';
import { RemoteAuthorityMeshMirror } from '../../apps/web/src/client/authority/remote-authority-mesh-mirror';
import { digest, sizer } from '../../apps/web/src/client/authority/remote-authority-projections';
import { authorityBaselineCaptureKeys } from '../../packages/game-core/src/server/authority/authority-baseline-capture';
import type { AuthorityBaselineCaptureResult } from '../../packages/game-core/src/server/authority/authority-baseline-capture-types';
import type { WorldCommitResult } from '../../packages/game-core/src/server/game-server-types';
import {
  createBaselineReferencePublicationQueue,
  prepareAuthorityBaselineReference,
} from '../../packages/game-core/src/server/protocol/network-reference-baseline';
import {
  createBaselineReferenceInFlightLedger,
  createBaselineReferenceSendQueue,
} from '../../packages/game-core/src/server/protocol/network-reference-baseline-budget';
import type { BaselinePageReference } from '../../packages/game-core/src/server/protocol/network-reference-baseline-types';
import { TEST_BASELINE_REF } from './support/network-baseline-consumer-fixture';

const limits = {
  metadataBytesMax: 64 * 1024,
  reliableMessageBytesMax: 1024 * 1024,
  baselineTransferBytesMax: 1024 * 1024,
  baselineInFlightBytesMax: 16 * 1024 * 1024,
  inboundMessagesPerSecond: 120,
  inboundBurst: 180,
  actionMessagesPerSecond: 30,
  interestKeysMax: 1,
  canonicalResidencyMax: 512,
  sendQueueBytesMax: 4 * 1024 * 1024,
};
const baselineLimits = {
  metadataBytesMax: limits.metadataBytesMax,
  reliableMessageBytesMax: limits.reliableMessageBytesMax,
  baselineTransferBytesMax: limits.baselineTransferBytesMax,
  baselineInFlightBytesMax: limits.baselineInFlightBytesMax,
  sendQueueBytesMax: limits.sendQueueBytesMax,
};

const commit = (key: string, revision: number): WorldCommitResult =>
  ({
    committed: true,
    worldRevision: revision,
    structuralChange: {
      type: 'voxel-region-changed',
      actorId: 'player-1',
      worldRevision: revision,
      mutationCount: 1,
      chunks: [key],
      chunkRevisions: [{ key, revision }],
      meshChunks: [key],
      bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    },
    semanticEvents: [],
    metrics: {},
  }) as unknown as WorldCommitResult;

function fixture(diagnosticsEnabled = false) {
  let nextRequestId = 10;
  let now = 0;
  const requests: Array<Readonly<{ requestId: number; key: string }>> = [];
  const pending = new Map<number, Readonly<{ resolve(): void; reject(error: Error): void }>>();
  const mirror = new RemoteAuthorityMeshMirror({
    nextRequestId: () => ++nextRequestId,
    createPending: (requestId) => new Promise<void>((resolve, reject) => pending.set(requestId, { resolve, reject })),
    resolvePending: (requestId) => pending.get(requestId)?.resolve(),
    rejectPending: (requestId, error) => pending.get(requestId)?.reject(error),
    requestBaseline: (requestId, key) => requests.push({ requestId, key }),
    cancelBaseline: () => undefined,
    diagnosticsEnabled,
    now: () => now,
  });
  mirror.initialize(TEST_BASELINE_REF, limits, 0);
  return { mirror, requests, advance: (elapsedMs: number) => (now += elapsedMs) };
}

async function pagedBundle(requestId = 11) {
  const key = '0,0,0';
  const keys = authorityBaselineCaptureKeys({ captureId: requestId, purpose: 'mesh', key, minimumRevision: 2 });
  const orderedKeys = [key, ...keys.filter((candidate) => candidate !== key)];
  const capture = {
    status: 'available',
    captureId: requestId,
    captureGeneration: requestId,
    purpose: 'mesh',
    key,
    checkpoint: { epoch: TEST_BASELINE_REF.epoch, physicsTick: 4, commitSequence: 5, worldRevision: 2 },
    entries: orderedKeys.map((entryKey, index) => {
      const canonical = new Uint16Array(32 ** 3);
      canonical[0] = 0x1234 + index;
      const fluid = new Uint8Array(32 ** 3);
      fluid[0] = index;
      return {
        role: index === 0 ? ('main' as const) : ('overlay' as const),
        key: entryKey,
        chunkRevision: 2,
        generatorVersion: 3,
        canonical: canonical.buffer,
        fluid: fluid.buffer,
      };
    }),
  } satisfies AuthorityBaselineCaptureResult;
  const prepared = await prepareAuthorityBaselineReference(capture, {
    ref: TEST_BASELINE_REF,
    requestId,
    interestId: requestId,
    expectedCapture: { captureId: requestId, captureGeneration: requestId, purpose: 'mesh', key, generatorVersion: 3 },
    minimumRevision: 2,
    referencePagePayloadBytes: 64 * 1024,
    pagesPerBundleMax: 128,
    limits: baselineLimits,
    digest,
    sizer,
    inFlight: createBaselineReferenceInFlightLedger(limits.baselineInFlightBytesMax),
  });
  if (!('publish' in prepared)) throw new Error(`Expected a baseline bundle, received ${prepared.reason}.`);
  const publication = createBaselineReferencePublicationQueue({ startBundleId: requestId });
  const published = prepared.publish(publication);
  const send = createBaselineReferenceSendQueue(limits.sendQueueBytesMax);
  const descriptorLease = publication.takeDescriptor(send);
  if (!descriptorLease) throw new Error('Expected a baseline descriptor lease.');
  const descriptor = descriptorLease.descriptor;
  descriptorLease.settle();
  const pages: BaselinePageReference[] = [];
  for (const entry of descriptor.entries)
    for (const block of entry.blocks)
      for (let pageIndex = 0; pageIndex < block.pageCount; pageIndex += 1) {
        const lease = published.materializePage({ entryId: entry.entryId, block: block.name, pageIndex }, send);
        if (!lease) throw new Error('Expected a baseline page lease.');
        pages.push(lease.page);
        lease.settle();
      }
  return { descriptor, pages, close: () => published.close() };
}

const acceptPage = (mirror: RemoteAuthorityMeshMirror, reference: BaselinePageReference) => {
  const { bytes, ...page } = reference;
  return mirror.acceptPage({ payloadBlock: 'payload', page }, [{ name: 'payload', bytes }]);
};

describe('remote Authority baseline causal barrier', () => {
  it.each([false, true])('ignores cancelled late pages and retries, digest in flight: %s', async (inFlight) => {
    const { mirror, requests } = fixture();
    const load = mirror.ensure(0, 0, 0).catch((error: Error) => error);
    const old = await pagedBundle();
    mirror.acceptDescriptor({ descriptor: old.descriptor });
    const firstPage = acceptPage(mirror, old.pages[0]!);
    if (!inFlight) await firstPage;
    mirror.release(0, 0, 0);
    await firstPage;
    expect(await load).toBeInstanceOf(Error);
    for (const page of old.pages.slice(1)) await acceptPage(mirror, page);
    const retry = mirror.ensure(0, 0, 0);
    const fresh = await pagedBundle(12);
    mirror.acceptDescriptor({ descriptor: fresh.descriptor });
    for (const page of fresh.pages) await acceptPage(mirror, page);
    await retry;
    expect(requests).toHaveLength(2);
    expect(mirror.readyOwnerCount).toBe(1);
    old.close();
    fresh.close();
    mirror.dispose();
  });

  it('still rejects pages without a descriptor when the bundle was never cancelled', async () => {
    const { mirror } = fixture();
    const bundle = await pagedBundle();
    await expect(acceptPage(mirror, bundle.pages[0]!)).rejects.toThrow('no active descriptor');
    bundle.close();
    mirror.dispose();
  });

  it('keeps bounded anonymous descriptor and page progress for initial-sync failure diagnostics', async () => {
    const { mirror, advance } = fixture(true);
    const load = mirror.ensure(0, 0, 0);
    const bundle = await pagedBundle();
    advance(5);
    mirror.acceptDescriptor({ descriptor: bundle.descriptor });
    advance(7);
    const firstPage = acceptPage(mirror, bundle.pages[0]!);
    const duringFirstPage = mirror.initialDiagnostics();
    expect(duringFirstPage.requests[0]).toMatchObject({ arrivalPages: 1, verifiedPages: 0 });
    expect(duringFirstPage.reassembler.activeBundles).toBe(1);
    expect(duringFirstPage.reassembler.reservedBlockBytes).toBeGreaterThan(0);
    await firstPage;
    for (const page of bundle.pages.slice(1)) await acceptPage(mirror, page);
    await load;
    for (let cx = 1; cx <= 9; cx += 1) void mirror.ensure(cx, 0, 0);

    const diagnostics = mirror.initialDiagnostics();
    expect(diagnostics.requests).toHaveLength(9);
    expect(diagnostics.requests[0]).toEqual({
      requestOrdinal: 1,
      state: 'ready',
      elapsedMs: 12,
      descriptorElapsedMs: 5,
      readyElapsedMs: 12,
      firstPageArrivalElapsedMs: 12,
      lastPageArrivalElapsedMs: 12,
      lastVerificationElapsedMs: 12,
      expectedPages: bundle.pages.length,
      arrivalPages: bundle.pages.length,
      arrivalBytes: bundle.pages.reduce((total, page) => total + page.bytes.byteLength, 0),
      verifiedPages: bundle.pages.length,
      verifiedBytes: bundle.pages.reduce((total, page) => total + page.bytes.byteLength, 0),
    });
    expect(diagnostics.reassembler).toEqual({ activeBundles: 0, digestingTransfers: 0, reservedBlockBytes: 0 });
    expect(JSON.stringify(diagnostics)).not.toContain('0,0,0');
    expect(
      diagnostics.requests.every((entry) => Object.keys(entry).every((key) => key !== 'key' && key !== 'requestId')),
    ).toBe(true);
    bundle.close();
    mirror.dispose();
  });

  it('rejects a capture made stale by a commit before its descriptor and immediately permits a fresh request', async () => {
    const { mirror, requests } = fixture();
    const load = mirror.ensure(0, 0, 0);
    const rejected = load.then(
      () => null,
      (error: Error) => error,
    );
    const bundle = await pagedBundle();
    mirror.consumeCommits([commit(bundle.descriptor.key, 3)]);
    mirror.acceptDescriptor({ descriptor: bundle.descriptor });
    for (const page of bundle.pages) await acceptPage(mirror, page);
    expect((await rejected)?.message).toMatch(/捕获期间已过期/);
    void mirror.ensure(0, 0, 0);
    expect(requests).toEqual([
      { requestId: 11, key: '0,0,0' },
      { requestId: 12, key: '0,0,0' },
    ]);
    bundle.close();
    mirror.dispose();
  });

  it('rejects a genuinely paged bundle when a newer commit arrives between its first and last page', async () => {
    const { mirror } = fixture();
    const load = mirror.ensure(0, 0, 0);
    const rejected = load.then(
      () => null,
      (error: Error) => error,
    );
    const bundle = await pagedBundle();
    expect(bundle.pages.length).toBeGreaterThan(2);
    mirror.acceptDescriptor({ descriptor: bundle.descriptor });
    await acceptPage(mirror, bundle.pages[0]!);
    expect(mirror.readyOwnerCount).toBe(0);
    mirror.consumeCommits([commit(bundle.descriptor.key, 3)]);
    for (const page of bundle.pages.slice(1)) await acceptPage(mirror, page);
    expect((await rejected)?.message).toMatch(/捕获期间已过期/);
    expect(mirror.readyOwnerCount).toBe(0);
    bundle.close();
    mirror.dispose();
  });

  it('rejects an old task result after the correct authority-complete Worker lease is invalidated', async () => {
    const { mirror } = fixture();
    const load = mirror.ensure(0, 0, 0);
    const bundle = await pagedBundle();
    mirror.acceptDescriptor({ descriptor: bundle.descriptor });
    for (const page of bundle.pages) await acceptPage(mirror, page);
    await load;
    const lease = mirror.prepareComplete(0, 0, 0);
    const task = {
      chunkKey: bundle.descriptor.key,
      chunkRevision: lease.input.chunkRevision,
      haloRevision: lease.input.haloRevision,
      generatorVersion: lease.input.generatorVersion,
    };
    const result = {
      canonical: lease.input.canonical.slice().buffer,
      authorityComplete: true as const,
      proceduralVoxelSamples: 0,
      macroContextCount: 0,
      haloRevision: lease.input.haloRevision,
      chunkRevision: lease.input.chunkRevision,
      generatorVersion: lease.input.generatorVersion,
    };
    expect(mirror.acceptMesh(task, result)).toBe(true);
    mirror.consumeCommits([commit(bundle.descriptor.key, 3)]);
    expect(mirror.acceptMesh(task, result)).toBe(false);
    lease.settle();
    bundle.close();
    mirror.dispose();
  });
});
