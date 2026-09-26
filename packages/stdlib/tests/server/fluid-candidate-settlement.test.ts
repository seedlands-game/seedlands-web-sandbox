import { describe, expect, it } from 'vitest';
import {
  FluidTransactionAuthority,
  computeFluidCandidate,
  type FluidCandidate,
  type FluidChunkSnapshot,
  type FluidPosition,
} from '../../src/server/fluid/fluid-transaction';
import { CHUNK_SIZE, chunkKey, floorDiv, mod, voxelIndex } from '../../src/world/voxel';

const keyFor = ([x, y, z]: FluidPosition) =>
  chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
const indexFor = ([x, y, z]: FluidPosition) => voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE));

describe('fluid candidate settlement', () => {
  it('installs bounded settlement state before apply and never re-reads the external candidate afterward', () => {
    const chunk: FluidChunkSnapshot = {
      key: chunkKey(0, 1, 0),
      cx: 0,
      cy: 1,
      cz: 0,
      revision: 0,
      voxels: new Uint16Array(CHUNK_SIZE ** 3),
      fluid: new Uint8Array(CHUNK_SIZE ** 3),
    };
    const chunks = new Map([[chunk.key, chunk]]);
    const external: { current?: FluidCandidate } = {};
    const authority = new FluidTransactionAuthority({
      epoch: 1,
      maxQueue: 1,
      readChunk: (key) => chunks.get(key) ?? null,
      readCell: (position) => {
        const current = chunks.get(keyFor(position));
        if (!current) return null;
        const index = indexFor(position);
        return { voxel: current.voxels[index], fluid: current.fluid[index] };
      },
      apply: (candidate) => {
        expect(Object.isFrozen(candidate)).toBe(true);
        expect(Object.isFrozen(candidate.writes)).toBe(true);
        expect(Object.isFrozen(candidate.writes[0]?.position)).toBe(true);
        for (const write of candidate.writes) {
          const current = chunks.get(keyFor(write.position))!;
          const index = indexFor(write.position);
          current.voxels[index] = write.voxel;
          current.fluid[index] = write.fluid;
        }
        if (!external.current) throw new Error('Missing external fixture.');
        Object.defineProperty(external.current, 'needsRescan', {
          configurable: true,
          enumerable: true,
          get: () => {
            throw new Error('candidate was read after canonical apply');
          },
        });
      },
    });
    authority.activate([0, 50, 0]);
    const lease = authority.requestFluidWork()!;
    external.current = computeFluidCandidate(lease);
    external.current.needsRescan = true;

    expect(authority.commitFluidCandidate(external.current)).toEqual({ accepted: true, commitSequence: 1 });
    expect(authority.diagnostics).toMatchObject({ inFlightLeaseCount: 0, acceptedCandidateCount: 1 });
    expect(authority.needsRescan).toContain('0,1,0');
  });
});
