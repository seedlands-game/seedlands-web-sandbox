import { describe, expect, it } from 'vitest';
import {
  FluidTransactionAuthority,
  computeFluidCandidate,
  type FluidAuthoritySnapshot,
  type FluidCellValue,
  type FluidChunkSnapshot,
  type FluidPosition,
} from '../../src/server/fluid/fluid-transaction';
import { CHUNK_SIZE, chunkKey, floorDiv, mod, voxelIndex, Voxel } from '../../src/world/voxel';

const keyFor = ([x, y, z]: FluidPosition) =>
  chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));

const localIndex = ([x, y, z]: FluidPosition) => voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE));

const makeChunk = (cx: number, cy: number, cz: number): FluidChunkSnapshot => ({
  key: chunkKey(cx, cy, cz),
  cx,
  cy,
  cz,
  revision: 0,
  voxels: new Uint16Array(CHUNK_SIZE ** 3),
  fluid: new Uint8Array(CHUNK_SIZE ** 3),
});

const setCell = (chunks: Map<string, FluidChunkSnapshot>, position: FluidPosition, value: FluidCellValue) => {
  const chunk = chunks.get(keyFor(position))!;
  const index = localIndex(position);
  chunk.voxels[index] = value.voxel;
  chunk.fluid[index] = value.fluid;
};

const applyCandidate = (
  chunks: Map<string, FluidChunkSnapshot>,
  candidate: ReturnType<typeof computeFluidCandidate>,
) => {
  const changedChunks = new Set<string>();
  for (const write of candidate.writes) {
    const chunk = chunks.get(keyFor(write.position))!;
    const index = localIndex(write.position);
    chunk.voxels[index] = write.voxel;
    chunk.fluid[index] = write.fluid;
    changedChunks.add(chunk.key);
  }
  for (const key of changedChunks) chunks.get(key)!.revision += 1;
};

const createAuthority = (chunks: Map<string, FluidChunkSnapshot>, maxQueue?: number) =>
  new FluidTransactionAuthority({
    epoch: 1,
    maxQueue,
    readChunk: (key) => chunks.get(key) ?? null,
    readCell: (position) => {
      const chunk = chunks.get(keyFor(position));
      if (!chunk) return null;
      const index = localIndex(position);
      return { voxel: chunk.voxels[index], fluid: chunk.fluid[index] };
    },
    apply: (candidate) => applyCandidate(chunks, candidate),
  });

const createSourceFlowLease = () => {
  const chunk = makeChunk(0, 1, 0);
  const chunks = new Map([[chunk.key, chunk]]);
  setCell(chunks, [0, 49, 0], { voxel: Voxel.Stone, fluid: 0 });
  setCell(chunks, [0, 50, 0], { voxel: Voxel.Water, fluid: 0x88 });
  const authority = createAuthority(chunks);
  authority.activate([0, 50, 0]);
  const lease = authority.requestFluidWork()!;
  const candidate = computeFluidCandidate(lease);
  return { authority, candidate, chunks, lease };
};

describe('fluid transactions', () => {
  it('reports real queue, lease, acceptance, rejection, and return counts', () => {
    const chunks = new Map([[chunkKey(0, 1, 0), makeChunk(0, 1, 0)]]);
    const authority = createAuthority(chunks);

    expect(authority.diagnostics).toEqual({
      pendingCellCount: 0,
      inFlightLeaseCount: 0,
      acceptedCandidateCount: 0,
      rejectedCandidateCount: 0,
      returnedLeaseCount: 0,
    });

    authority.activate([0, 50, 0]);
    expect(authority.diagnostics.pendingCellCount).toBeGreaterThan(0);
    const aborted = authority.requestFluidWork()!;
    expect(authority.diagnostics.inFlightLeaseCount).toBe(1);
    expect(authority.abortLease(aborted.workId, 'worker-crash')).toBe(true);
    expect(authority.diagnostics).toMatchObject({ inFlightLeaseCount: 0, returnedLeaseCount: 1 });

    const rejected = computeFluidCandidate(authority.requestFluidWork()!);
    expect(authority.commitFluidCandidate({ ...rejected, epoch: 2 })).toEqual({ accepted: false, reason: 'epoch' });
    expect(authority.diagnostics).toMatchObject({ rejectedCandidateCount: 1, returnedLeaseCount: 2 });

    const accepted = computeFluidCandidate(authority.requestFluidWork()!);
    expect(authority.commitFluidCandidate(accepted)).toEqual(expect.objectContaining({ accepted: true }));
    expect(authority.diagnostics).toMatchObject({
      inFlightLeaseCount: 0,
      acceptedCandidateCount: 1,
      rejectedCandidateCount: 1,
      returnedLeaseCount: 2,
    });
  });

  it('computes from a versioned local snapshot without an authority callback', () => {
    const snapshot: FluidAuthoritySnapshot = {
      protocolVersion: 1,
      epoch: 7,
      workId: 'fluid-7-1',
      frontier: [[0, 50, 0]],
      chunks: [makeChunk(0, 1, 0)],
    };
    const chunk = snapshot.chunks[0];
    chunk.voxels[localIndex([0, 49, 0])] = Voxel.Stone;
    chunk.voxels[localIndex([0, 50, 0])] = Voxel.Water;
    chunk.fluid[localIndex([0, 50, 0])] = 0x88;

    const candidate = computeFluidCandidate(snapshot);

    expect(candidate).toMatchObject({
      protocolVersion: 1,
      epoch: 7,
      workId: 'fluid-7-1',
      consumedFrontier: [[0, 50, 0]],
    });
    expect(candidate.readSet).toEqual([{ key: '0,1,0', revision: 0 }]);
    expect(candidate.writes).toContainEqual(
      expect.objectContaining({ position: [1, 50, 0], expectedVoxel: Voxel.Air, voxel: Voxel.Water, fluid: 7 }),
    );
  });

  it('rejects a stale chunk revision and returns the leased frontier for a later work item', () => {
    const chunks = new Map([[chunkKey(0, 1, 0), makeChunk(0, 1, 0)]]);
    const authority = new FluidTransactionAuthority({
      epoch: 3,
      readChunk: (key) => chunks.get(key) ?? null,
      readCell: (position) => {
        const chunk = chunks.get(keyFor(position));
        if (!chunk) return null;
        const index = localIndex(position);
        return { voxel: chunk.voxels[index], fluid: chunk.fluid[index] };
      },
      apply: () => undefined,
    });
    authority.activate([0, 50, 0]);
    const snapshot = authority.requestFluidWork()!;
    chunks.get('0,1,0')!.revision += 1;

    expect(authority.commitFluidCandidate(computeFluidCandidate(snapshot))).toEqual({
      accepted: false,
      reason: 'read-set',
    });
    expect(authority.requestFluidWork()?.frontier).toEqual(snapshot.frontier);
  });

  it('treats an expected old cell mismatch as a transaction conflict and keeps the work live', () => {
    const chunks = new Map([[chunkKey(0, 1, 0), makeChunk(0, 1, 0)]]);
    const authority = new FluidTransactionAuthority({
      epoch: 3,
      readChunk: (key) => chunks.get(key) ?? null,
      readCell: (position) => {
        const chunk = chunks.get(keyFor(position));
        if (!chunk) return null;
        const index = localIndex(position);
        return { voxel: chunk.voxels[index], fluid: chunk.fluid[index] };
      },
      apply: () => undefined,
    });
    authority.activate([0, 50, 0]);
    const snapshot = authority.requestFluidWork()!;
    const candidate = {
      ...computeFluidCandidate(snapshot),
      writes: [
        {
          position: [0, 50, 0] as FluidPosition,
          expectedVoxel: Voxel.Air,
          expectedFluid: 0,
          voxel: Voxel.Water,
          fluid: 7,
        },
      ],
    };
    const first = candidate.writes[0];
    setCell(chunks, first.position, { voxel: Voxel.Stone, fluid: 0 });

    expect(authority.commitFluidCandidate(candidate)).toEqual({ accepted: false, reason: 'cell-conflict' });
    expect(authority.requestFluidWork()?.frontier).toEqual(snapshot.frontier);
  });

  it('returns a crashed lease and remembers overflow regions for rescan', () => {
    const chunk = makeChunk(0, 1, 0);
    const authority = new FluidTransactionAuthority({
      epoch: 1,
      maxQueue: 1,
      readChunk: (key) => (key === chunk.key ? chunk : null),
      readCell: () => ({ voxel: Voxel.Air, fluid: 0 }),
      apply: () => undefined,
    });
    authority.activate([0, 50, 0]);
    authority.activate([1, 50, 0]);
    const snapshot = authority.requestFluidWork()!;
    expect(authority.abortLease(snapshot.workId, 'worker-crash')).toBe(true);
    expect(authority.requestFluidWork()?.frontier).toEqual(snapshot.frontier);
    expect(authority.needsRescan).toContain('0,1,0');
  });

  it('rescans an overflowed chunk incrementally and returns its pending water to the frontier', () => {
    const chunk = makeChunk(0, 1, 0);
    chunk.voxels[0] = Voxel.Water;
    chunk.fluid[0] = 0x88;
    const authority = new FluidTransactionAuthority({
      epoch: 1,
      maxQueue: 1,
      readChunk: (key) => (key === chunk.key ? chunk : null),
      readCell: (position) => {
        const index = localIndex(position);
        return { voxel: chunk.voxels[index], fluid: chunk.fluid[index] };
      },
      apply: () => undefined,
    });
    authority.activate([10, 32, 0]);
    const first = authority.requestFluidWork()!;
    expect(authority.commitFluidCandidate(computeFluidCandidate(first))).toEqual(
      expect.objectContaining({ accepted: true }),
    );

    expect(authority.requestFluidWork()?.frontier).toContainEqual([0, 32, 0]);
  });

  it('uses the normal bounded frontier for source-removal relaxation', () => {
    const chunk = makeChunk(0, 1, 0);
    const authority = new FluidTransactionAuthority({
      epoch: 1,
      readChunk: (key) => (key === chunk.key ? chunk : null),
      readCell: () => ({ voxel: Voxel.Air, fluid: 0 }),
      apply: () => undefined,
    });
    authority.activate([0, 50, 0]);
    for (let index = 0; index < 128; index += 1) authority.removeSource([index * 3, 50, 0]);

    const snapshot = authority.requestFluidWork()!;
    expect(snapshot.cleanupFrontier).toEqual([]);
    expect(snapshot.frontier).toHaveLength(128);
  });

  it('requires the complete lease read set and returns a malformed result lease', () => {
    const chunk = makeChunk(0, 1, 0);
    const authority = new FluidTransactionAuthority({
      epoch: 2,
      readChunk: (key) => (key === chunk.key ? chunk : null),
      readCell: () => ({ voxel: Voxel.Air, fluid: 0 }),
      apply: () => undefined,
    });
    authority.activate([0, 50, 0]);
    const snapshot = authority.requestFluidWork()!;
    const candidate = { ...computeFluidCandidate(snapshot), readSet: [] };

    expect(authority.commitFluidCandidate(candidate)).toEqual({ accepted: false, reason: 'read-set' });
    expect(authority.requestFluidWork()?.frontier).toEqual(snapshot.frontier);
  });

  it('rejects a valid-byte write outside the leased local computation', () => {
    const { authority, candidate, lease } = createSourceFlowLease();
    const forged = {
      ...candidate,
      writes: [
        {
          position: [20, 50, 20] as FluidPosition,
          expectedVoxel: Voxel.Air,
          expectedFluid: 0,
          voxel: Voxel.Water,
          fluid: 7,
        },
      ],
    };

    expect(authority.commitFluidCandidate(forged)).toEqual({ accepted: false, reason: 'invalid-result' });
    expect(authority.requestFluidWork()?.frontier).toEqual(lease.frontier);
  });

  it('rejects duplicate writes and invalid fluid bytes', () => {
    const first = createSourceFlowLease();
    const write = first.candidate.writes[0]!;
    expect(first.authority.commitFluidCandidate({ ...first.candidate, writes: [write, { ...write }] })).toEqual({
      accepted: false,
      reason: 'invalid-result',
    });

    const second = createSourceFlowLease();
    expect(
      second.authority.commitFluidCandidate({
        ...second.candidate,
        writes: [{ ...second.candidate.writes[0]!, voxel: Voxel.Water, fluid: 255 }],
      }),
    ).toEqual({ accepted: false, reason: 'invalid-result' });

    const third = createSourceFlowLease();
    expect(
      third.authority.commitFluidCandidate({
        ...third.candidate,
        writes: [{ ...third.candidate.writes[0]!, expectedVoxel: Voxel.Water, expectedFluid: 2 ** 32 + 0x88 }],
      }),
    ).toEqual({ accepted: false, reason: 'invalid-result' });
  });

  it('rejects terrain deletion disguised as a fluid write', () => {
    const { authority, candidate } = createSourceFlowLease();

    expect(
      authority.commitFluidCandidate({
        ...candidate,
        writes: [
          {
            position: [0, 49, 0],
            expectedVoxel: Voxel.Stone,
            expectedFluid: 0,
            voxel: Voxel.Air,
            fluid: 0,
          },
        ],
      }),
    ).toEqual({ accepted: false, reason: 'invalid-result' });
  });

  it('rejects changing a source Water cell inside the compute candidate', () => {
    const { authority, candidate } = createSourceFlowLease();

    expect(
      authority.commitFluidCandidate({
        ...candidate,
        writes: [
          {
            position: [0, 50, 0],
            expectedVoxel: Voxel.Water,
            expectedFluid: 0x88,
            voxel: Voxel.Water,
            fluid: 7,
          },
        ],
      }),
    ).toEqual({ accepted: false, reason: 'invalid-result' });
  });

  it('rejects a remote next frontier and non-finite coordinates', () => {
    const first = createSourceFlowLease();
    expect(first.authority.commitFluidCandidate({ ...first.candidate, nextFrontier: [[20, 50, 20]] })).toEqual({
      accepted: false,
      reason: 'invalid-result',
    });

    const second = createSourceFlowLease();
    expect(
      second.authority.commitFluidCandidate({
        ...second.candidate,
        nextCleanupFrontier: [[Number.POSITIVE_INFINITY, 50, 0]],
      }),
    ).toEqual({ accepted: false, reason: 'invalid-result' });

    const third = createSourceFlowLease();
    const repeated = third.candidate.nextFrontier[0] ?? third.lease.frontier[0]!;
    expect(
      third.authority.commitFluidCandidate({
        ...third.candidate,
        nextFrontier: [repeated],
        nextCleanupFrontier: [repeated],
      }),
    ).toEqual({ accepted: false, reason: 'invalid-result' });

    const fourth = createSourceFlowLease();
    expect(
      fourth.authority.commitFluidCandidate({
        ...fourth.candidate,
        nextFrontier: Array.from({ length: 1_000 }, (_, index) => [index, 50, 0] as FluidPosition),
      }),
    ).toEqual({ accepted: false, reason: 'invalid-result' });
  });

  it('accepts bounded propagation from a legal 0x88 source', () => {
    const { authority, candidate } = createSourceFlowLease();

    expect(candidate.writes).toContainEqual(
      expect.objectContaining({ expectedVoxel: Voxel.Air, expectedFluid: 0, voxel: Voxel.Water }),
    );
    expect(authority.commitFluidCandidate(candidate)).toEqual(expect.objectContaining({ accepted: true }));
  });

  it('does not exceed queue capacity while a lease is in flight', () => {
    const chunk = makeChunk(0, 1, 0);
    const authority = new FluidTransactionAuthority({
      epoch: 2,
      maxQueue: 1,
      readChunk: (key) => (key === chunk.key ? chunk : null),
      readCell: () => ({ voxel: Voxel.Air, fluid: 0 }),
      apply: () => undefined,
    });
    authority.activate([0, 50, 0]);
    const snapshot = authority.requestFluidWork()!;
    authority.activate([20, 50, 0]);
    authority.abortLease(snapshot.workId, 'test');

    expect(authority.pending).toBeLessThanOrEqual(1);
    expect(authority.needsRescan).not.toHaveLength(0);
  });

  it('returns a lease when a result changes its consumed frontier', () => {
    const chunk = makeChunk(0, 1, 0);
    const authority = new FluidTransactionAuthority({
      epoch: 2,
      readChunk: (key) => (key === chunk.key ? chunk : null),
      readCell: () => ({ voxel: Voxel.Air, fluid: 0 }),
      apply: () => undefined,
    });
    authority.activate([0, 50, 0]);
    const snapshot = authority.requestFluidWork()!;
    const candidate = { ...computeFluidCandidate(snapshot), consumedFrontier: [] };

    expect(authority.commitFluidCandidate(candidate)).toEqual({ accepted: false, reason: 'work-id' });
    expect(authority.requestFluidWork()?.frontier).toEqual(snapshot.frontier);
  });

  it('keeps a cross-chunk flow with only its one-hop local read set', () => {
    const chunks = new Map(
      [0, 1].map((cx) => {
        const chunk = makeChunk(cx, 0, 0);
        return [chunk.key, chunk] as const;
      }),
    );
    for (let x = 29; x <= 33; x += 1) {
      setCell(chunks, [x, 4, 5], { voxel: Voxel.Stone, fluid: 0 });
      setCell(chunks, [x, 5, 5], { voxel: Voxel.Water, fluid: x === 33 ? 0x88 : 8 - (33 - x) });
    }
    const authority = createAuthority(chunks);

    authority.removeSource([28, 5, 5]);
    const candidate = computeFluidCandidate(authority.requestFluidWork()!);

    expect(candidate.readSet).toEqual([{ key: '0,0,0', revision: 0 }]);
    expect(candidate.writes).not.toContainEqual(expect.objectContaining({ position: [29, 5, 5], voxel: Voxel.Air }));
    expect(candidate.needsRescan).toBe(false);
  });

  it('preserves a local flow at an unloaded boundary and resumes after the dependency loads', () => {
    const left = makeChunk(0, 0, 0);
    const chunks = new Map([[left.key, left]]);
    setCell(chunks, [31, 4, 5], { voxel: Voxel.Stone, fluid: 0 });
    setCell(chunks, [31, 5, 5], { voxel: Voxel.Water, fluid: 4 });
    const authority = createAuthority(chunks);

    authority.removeSource([30, 5, 5]);
    const pending = computeFluidCandidate(authority.requestFluidWork()!);
    expect(pending.needsRescan).toBe(true);
    expect(pending.nextFrontier).toContainEqual([31, 5, 5]);
    expect(pending.writes).not.toContainEqual(expect.objectContaining({ position: [31, 5, 5], voxel: Voxel.Air }));
    expect(authority.commitFluidCandidate(pending)).toEqual(expect.objectContaining({ accepted: true }));

    const right = makeChunk(1, 0, 0);
    chunks.set(right.key, right);
    setCell(chunks, [32, 4, 5], { voxel: Voxel.Stone, fluid: 0 });
    setCell(chunks, [32, 5, 5], { voxel: Voxel.Water, fluid: 0x88 });

    let resumed: ReturnType<typeof computeFluidCandidate> | null = null;
    for (let attempt = 0; attempt < 4 && !resumed; attempt += 1) {
      const lease = authority.requestFluidWork();
      if (!lease) continue;
      const candidate = computeFluidCandidate(lease);
      if (candidate.consumedFrontier.some((position) => position[0] === 31 && position[1] === 5 && position[2] === 5))
        resumed = candidate;
      expect(authority.commitFluidCandidate(candidate)).toEqual(expect.objectContaining({ accepted: true }));
    }

    expect(resumed).not.toBeNull();
    expect(resumed!.writes).not.toContainEqual(expect.objectContaining({ position: [31, 5, 5], voxel: Voxel.Air }));
  });

  it('does not lower a water level from an unknown stronger neighbor', () => {
    const left = makeChunk(0, 0, 0);
    const chunks = new Map([[left.key, left]]);
    setCell(chunks, [31, 4, 5], { voxel: Voxel.Stone, fluid: 0 });
    setCell(chunks, [31, 5, 5], { voxel: Voxel.Water, fluid: 7 });
    setCell(chunks, [30, 4, 5], { voxel: Voxel.Stone, fluid: 0 });
    setCell(chunks, [30, 5, 5], { voxel: Voxel.Water, fluid: 2 });
    const authority = createAuthority(chunks);

    authority.activate([31, 5, 5]);
    const pending = computeFluidCandidate(authority.requestFluidWork()!);
    expect(pending.needsRescan).toBe(true);
    expect(pending.writes).not.toContainEqual(expect.objectContaining({ position: [31, 5, 5] }));
    expect(pending.nextFrontier).toContainEqual([31, 5, 5]);
    expect(authority.commitFluidCandidate(pending)).toEqual(expect.objectContaining({ accepted: true }));

    const right = makeChunk(1, 0, 0);
    chunks.set(right.key, right);
    setCell(chunks, [32, 4, 5], { voxel: Voxel.Stone, fluid: 0 });
    setCell(chunks, [32, 5, 5], { voxel: Voxel.Water, fluid: 0x88 });
    let settled: ReturnType<typeof computeFluidCandidate> | null = null;
    for (let attempt = 0; attempt < 4 && !settled; attempt += 1) {
      const lease = authority.requestFluidWork();
      if (!lease) continue;
      const candidate = computeFluidCandidate(lease);
      if (candidate.consumedFrontier.some((position) => position[0] === 31 && position[1] === 5 && position[2] === 5))
        settled = candidate;
      expect(authority.commitFluidCandidate(candidate)).toEqual(expect.objectContaining({ accepted: true }));
    }

    expect(settled).not.toBeNull();
    expect(settled!.writes).not.toContainEqual(expect.objectContaining({ position: [31, 5, 5], fluid: 1 }));
    expect(chunks.get('0,0,0')!.fluid[localIndex([31, 5, 5])]).toBe(7);
  });

  it('drains a unique removed source through bounded local steps', () => {
    const chunk = makeChunk(0, 0, 0);
    const chunks = new Map([[chunk.key, chunk]]);
    for (let x = 5; x <= 9; x += 1) {
      setCell(chunks, [x, 4, 5], { voxel: Voxel.Stone, fluid: 0 });
      setCell(chunks, [x, 5, 4], { voxel: Voxel.Stone, fluid: 0 });
      setCell(chunks, [x, 5, 6], { voxel: Voxel.Stone, fluid: 0 });
    }
    setCell(chunks, [9, 5, 5], { voxel: Voxel.Stone, fluid: 0 });
    for (const [x, level] of [
      [6, 7],
      [7, 6],
      [8, 5],
    ] as const) {
      setCell(chunks, [x, 4, 5], { voxel: Voxel.Stone, fluid: 0 });
      setCell(chunks, [x, 5, 5], { voxel: Voxel.Water, fluid: level });
    }
    const authority = createAuthority(chunks);

    authority.removeSource([5, 5, 5]);
    for (let step = 0; step < 80; step += 1) {
      const lease = authority.requestFluidWork();
      if (!lease) break;
      expect(authority.commitFluidCandidate(computeFluidCandidate(lease))).toEqual(
        expect.objectContaining({ accepted: true }),
      );
    }

    for (let x = 6; x <= 8; x += 1) expect(chunks.get('0,0,0')!.voxels[localIndex([x, 5, 5])]).toBe(Voxel.Air);
  });

  it('limits overflow rescans to a bounded slice and reaches later cells on a later request', () => {
    const chunk = makeChunk(0, 0, 0);
    const chunks = new Map([[chunk.key, chunk]]);
    const deferred: FluidPosition = [8, 0, 6];
    setCell(chunks, deferred, { voxel: Voxel.Water, fluid: 0x88 });
    const authority = createAuthority(chunks, 1);

    authority.activate([0, 32, 0]);
    const first = authority.requestFluidWork()!;
    expect(authority.commitFluidCandidate(computeFluidCandidate(first))).toEqual(
      expect.objectContaining({ accepted: true }),
    );
    expect(authority.requestFluidWork()).toBeNull();

    expect(authority.requestFluidWork()?.frontier).toContainEqual(deferred);
  });
});
