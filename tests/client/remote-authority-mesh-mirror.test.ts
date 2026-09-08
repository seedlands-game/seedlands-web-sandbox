import { describe, expect, it } from 'vitest';
import { RemoteAuthorityMeshMirror } from '../../apps/web/src/client/authority/remote-authority-mesh-mirror';
import type { WorldCommitResult } from '../../packages/game-core/src/server/game-server-types';
import type { BaselineReferenceReassembler } from '../../packages/game-core/src/server/protocol/network-reference-baseline-types';
import {
  makeBaselineOwner,
  makeReassembledBaseline,
  TEST_BASELINE_REF,
} from './support/network-baseline-consumer-fixture';

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

function fixture() {
  let nextRequestId = 10;
  const requests: Array<Readonly<{ requestId: number; key: string }>> = [];
  const pending = new Map<number, Readonly<{ resolve(): void; reject(error: Error): void }>>();
  const mirror = new RemoteAuthorityMeshMirror({
    nextRequestId: () => ++nextRequestId,
    createPending: (requestId) =>
      new Promise<void>((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
      }),
    resolvePending: (requestId) => pending.get(requestId)?.resolve(),
    rejectPending: (requestId, error) => pending.get(requestId)?.reject(error),
    requestBaseline: (requestId, key) => requests.push({ requestId, key }),
    cancelBaseline: () => undefined,
  });
  mirror.initialize(TEST_BASELINE_REF, limits, 0);
  return { mirror, requests };
}

function installBundle(mirror: RemoteAuthorityMeshMirror, requestId = 11) {
  const owner = makeBaselineOwner({ requestId, ownerId: requestId, ownerGeneration: requestId });
  const bundle = makeReassembledBaseline(owner);
  const reassembler = {
    acceptDescriptor: () => undefined,
    acceptPage: async () => bundle,
    cancel: async () => 'cancelled' as const,
    close: async () => undefined,
  } as unknown as BaselineReferenceReassembler;
  (mirror as unknown as { reassembler: BaselineReferenceReassembler }).reassembler = reassembler;
  return bundle;
}

const acceptSyntheticPage = (mirror: RemoteAuthorityMeshMirror, bundleId: number) =>
  mirror.acceptPage({ payloadBlock: 'payload', page: { bundleId } }, [{ name: 'payload', bytes: new Uint8Array([1]) }]);

describe('remote Authority baseline causal barrier', () => {
  it('rejects a capture made stale by a commit before its descriptor and immediately permits a fresh request', async () => {
    const { mirror, requests } = fixture();
    const load = mirror.ensure(0, 0, 0);
    const rejected = expect(load).rejects.toThrow(/捕获期间已过期/);
    const bundle = installBundle(mirror);

    mirror.consumeCommits([commit(bundle.descriptor.key, 3)]);
    mirror.acceptDescriptor({ descriptor: bundle.descriptor });
    await acceptSyntheticPage(mirror, bundle.descriptor.bundleId);
    await rejected;

    void mirror.ensure(0, 0, 0);
    expect(requests).toEqual([
      { requestId: 11, key: '0,0,0' },
      { requestId: 12, key: '0,0,0' },
    ]);
    mirror.dispose();
  });

  it('rejects an in-progress paged bundle when a newer commit arrives after the descriptor', async () => {
    const { mirror } = fixture();
    const load = mirror.ensure(0, 0, 0);
    const rejected = expect(load).rejects.toThrow(/捕获期间已过期/);
    const bundle = installBundle(mirror);

    mirror.acceptDescriptor({ descriptor: bundle.descriptor });
    mirror.consumeCommits([commit(bundle.descriptor.key, 3)]);
    await acceptSyntheticPage(mirror, bundle.descriptor.bundleId);
    await rejected;
    expect(mirror.readyOwnerCount).toBe(0);
    mirror.dispose();
  });

  it('accepts only the task-specific authority-complete Worker result identity', async () => {
    const { mirror } = fixture();
    const load = mirror.ensure(0, 0, 0);
    const bundle = installBundle(mirror);
    mirror.acceptDescriptor({ descriptor: bundle.descriptor });
    await acceptSyntheticPage(mirror, bundle.descriptor.bundleId);
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
    expect(mirror.acceptMesh(task, { ...result, haloRevision: 'stale-task' })).toBe(false);
    expect(mirror.acceptMesh(task, result)).toBe(true);
    lease.settle();
    mirror.dispose();
  });
});
