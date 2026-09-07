// @ts-expect-error -- The frozen A checkout exists only while this historical comparison runner is prepared.
import { AuthorityCollisionBaselineClient as FrozenCollisionBaselineClient } from '/tmp/seedlands-adoption-baseline/src/client/authority-collision-baseline-client';
import {
  AuthorityCollisionRevisionGuard as FrozenCollisionRevisionGuard,
  acceptAuthorityCollisionBaseline as acceptFrozenGeneratedCanonical,
  // @ts-expect-error -- The frozen A checkout exists only while this historical comparison runner is prepared.
} from '/tmp/seedlands-adoption-baseline/src/client/authority-collision-mirror';
// @ts-expect-error -- The frozen A checkout exists only while this historical comparison runner is prepared.
import { computeFluidCandidate as computeFrozenFluid } from '/tmp/seedlands-adoption-baseline/src/server/fluid/fluid-transaction';
import { AuthorityCollisionBaselineClient } from '../../../src/client/authority/authority-collision-baseline-client';
import {
  AuthorityCollisionRevisionGuard,
  consumeTransferredAuthorityCollisionBaseline,
  type AuthorityCollisionCachedChunk,
} from '../../../src/client/authority/authority-collision-mirror';
import { consumeFluidCandidate, type FluidAuthoritySnapshot } from '../../../src/server/fluid/fluid-transaction';
import { CHUNK_SIZE } from '../../../src/world/voxel';
import { makeWorkloadCorpus } from './workload-corpus';

const cloneSnapshot = (snapshot: FluidAuthoritySnapshot): FluidAuthoritySnapshot => ({
  ...snapshot,
  frontier: snapshot.frontier.map((position) => [...position] as [number, number, number]),
  ...(snapshot.cleanupFrontier
    ? { cleanupFrontier: snapshot.cleanupFrontier.map((position) => [...position] as [number, number, number]) }
    : {}),
  chunks: snapshot.chunks.map((chunk) => ({ ...chunk, voxels: chunk.voxels.slice(), fluid: chunk.fluid.slice() })),
});

const settleClientRequest = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

/**
 * The caller invokes reset outside the timed interval. Each run follows the
 * real client response path with fresh, already-transferred task buffers.
 */
export const createCollisionBaselineCopyCase = () => {
  let canonical = new Uint16Array(CHUNK_SIZE ** 3);
  let fluid = new Uint8Array(CHUNK_SIZE ** 3);
  const reset = () => {
    canonical = new Uint16Array(CHUNK_SIZE ** 3);
    fluid = new Uint8Array(CHUNK_SIZE ** 3);
  };
  const runOriginal = async () => {
    const chunks = new Map();
    const client = new FrozenCollisionBaselineClient(chunks, new FrozenCollisionRevisionGuard(), async () => ({
      status: 'available' as const,
      key: '0,0,0',
      chunkRevision: 1,
      canonical: canonical.buffer,
      fluid: fluid.buffer,
    }));
    client.synchronize({ '0,0,0': 1 });
    await settleClientRequest();
    return chunks.get('0,0,0');
  };
  const runFixed = async () => {
    const chunks = new Map<string, AuthorityCollisionCachedChunk>();
    const client = new AuthorityCollisionBaselineClient(
      chunks,
      new AuthorityCollisionRevisionGuard(),
      async () => ({
        status: 'available' as const,
        key: '0,0,0',
        chunkRevision: 1,
        canonical: canonical.buffer,
        fluid: fluid.buffer,
      }),
      { consumeTransferredBuffers: true },
    );
    client.synchronize({ '0,0,0': 1 });
    await settleClientRequest();
    return chunks.get('0,0,0');
  };
  return {
    reset,
    runOriginal,
    runFixed,
  };
};

/** Prepared-hit generated canonical path: no Authority transfer is requested. */
export const createGeneratedCanonicalCopyCase = () => {
  let canonical = new Uint16Array(CHUNK_SIZE ** 3);
  const reset = () => {
    canonical = new Uint16Array(CHUNK_SIZE ** 3);
  };
  const runOriginal = () => {
    const chunks = new Map();
    return acceptFrozenGeneratedCanonical({
      key: '0,0,0',
      chunkRevision: 1,
      generatorVersion: 3,
      result: { canonical: canonical.buffer, generatorVersion: 3 },
      chunks,
      guard: new FrozenCollisionRevisionGuard(),
      accept: async () => true,
    });
  };
  const runFixed = () => {
    const chunks = new Map<string, AuthorityCollisionCachedChunk>();
    return consumeTransferredAuthorityCollisionBaseline({
      key: '0,0,0',
      chunkRevision: 1,
      generatorVersion: 3,
      result: { canonical: canonical.buffer, generatorVersion: 3 },
      chunks,
      guard: new AuthorityCollisionRevisionGuard(),
      accept: async () => true,
    });
  };
  return {
    reset,
    runOriginal,
    runFixed,
  };
};

/**
 * Thirty W07 corpus tasks. reset() is required before every fixed sample
 * because consumeFluidCandidate deliberately mutates the task-owned arrays.
 */
export const createFluidCopyCase = () => {
  const source = makeWorkloadCorpus('w07', 30).map((entry) => {
    if (entry.kind !== 'w07') throw new Error('Expected W07 fluid corpus input.');
    return entry.snapshot;
  });
  let tasks = source.map(cloneSnapshot);
  return {
    reset: () => {
      tasks = source.map(cloneSnapshot);
    },
    runOriginal: () => tasks.map((snapshot) => computeFrozenFluid(snapshot)),
    runFixed: () => tasks.map((snapshot) => consumeFluidCandidate(snapshot)),
  };
};
