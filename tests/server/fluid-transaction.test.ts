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

describe('fluid transactions', () => {
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

  it('reserves half of a work item for normal frontier when source cleanup is busy', () => {
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
    expect(snapshot.cleanupFrontier).toHaveLength(64);
    expect(snapshot.frontier.length).toBeGreaterThan(0);
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
});
