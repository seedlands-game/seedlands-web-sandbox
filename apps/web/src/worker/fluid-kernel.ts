import {
  computeFluidCandidate,
  type FluidCandidate,
  type FluidPosition,
} from '@seedlands/stdlib/server/fluid/fluid-transaction';
import type { KernelMemory } from '../compute/kernel-memory';
import { CHUNK_SIZE, chunkKey, floorDiv, mod, voxelIndex } from '@seedlands/stdlib/world/voxel';

const WRITES = 4 * 1024 * 1024;
const NEXT = 5 * 1024 * 1024;
const compare = (a: FluidPosition, b: FluidPosition) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export function createFluidKernel(
  kernel: KernelMemory,
  fallback: typeof computeFluidCandidate = computeFluidCandidate,
): typeof computeFluidCandidate {
  return (snapshot) => {
    const positions = [...(snapshot.cleanupFrontier ?? []), ...snapshot.frontier];
    if (
      kernel.failed ||
      snapshot.protocolVersion !== 1 ||
      snapshot.chunks.length > 32 ||
      positions.length > 192 ||
      positions.some((position) => position.some((value) => !Number.isInteger(value) || Math.abs(value) >= 2 ** 29))
    )
      return fallback(snapshot);
    const chunks = [...new Map(snapshot.chunks.map((chunk) => [chunk.key, chunk])).values()];
    if (
      chunks.some(
        (chunk) =>
          chunk.key !== `${chunk.cx},${chunk.cy},${chunk.cz}` ||
          chunk.voxels.length !== 32768 ||
          chunk.fluid.length !== 32768,
      )
    )
      return fallback(snapshot);
    try {
      kernel.u32(64, 8).fill(0);
      kernel.u32(64, 1)[0] = chunks.length;
      const regions = new Map<string, { voxelOffset: number; fluidOffset: number }>();
      let offset = 65536;
      chunks.forEach((chunk, index) => {
        regions.set(chunk.key, { voxelOffset: offset, fluidOffset: offset + 65536 });
        kernel.u32(1024 + index * 20, 5).set([chunk.cx, chunk.cy, chunk.cz, offset, offset + 65536]);
        kernel.u16(offset, 32768).set(chunk.voxels);
        kernel.bytes(offset + 65536, 32768).set(chunk.fluid);
        offset += 98304;
      });
      const frontier = kernel.u32(8192, positions.length * 3);
      positions.forEach((position, index) => frontier.set(position, index * 3));
      if (kernel.invoke('fluid_candidate', positions.length) !== 0) throw new Error('Fluid kernel capacity exceeded.');
      const header = kernel.u32(64, 8);
      const writeCount = header[2];
      const nextCount = header[3];
      if (writeCount > 2048 || nextCount > 16384) throw new Error('Fluid kernel result count is invalid.');
      const rows = kernel.u32(WRITES, writeCount * 6);
      const signedRows = new Int32Array(rows.buffer, rows.byteOffset, rows.length);
      const writes: FluidCandidate['writes'] = [];
      for (let index = 0; index < writeCount; index += 1) {
        const row = index * 6;
        const x = signedRows[row];
        const y = signedRows[row + 1];
        const z = signedRows[row + 2];
        const region = regions.get(chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)));
        if (!region) throw new Error('Fluid kernel returned a write outside the supplied chunks.');
        const local = voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE));
        if (rows[row + 4] !== region.voxelOffset + local * 2 || rows[row + 5] !== region.fluidOffset + local)
          throw new Error('Fluid kernel returned a write with an invalid input pointer.');
        const original = rows[row + 3];
        const voxel = kernel.u16(rows[row + 4], 1)[0];
        const fluid = kernel.bytes(rows[row + 5], 1)[0];
        if ((original & 65535) === voxel && original >>> 16 === fluid) continue;
        writes.push({
          position: [x, y, z],
          expectedVoxel: original & 65535,
          expectedFluid: original >>> 16,
          voxel,
          fluid,
        });
      }
      const nextRows = kernel.u32(NEXT, nextCount * 3);
      const signedNext = new Int32Array(nextRows.buffer, nextRows.byteOffset, nextRows.length);
      const next = new Map<string, FluidPosition>();
      for (let index = 0; index < nextCount; index += 1) {
        const position: FluidPosition = [signedNext[index * 3], signedNext[index * 3 + 1], signedNext[index * 3 + 2]];
        next.set(position.join(','), position);
      }
      return {
        protocolVersion: 1,
        epoch: snapshot.epoch,
        workId: snapshot.workId,
        readSet: snapshot.chunks
          .map(({ key, revision }) => ({ key, revision }))
          .sort((a, b) =>
            compare(
              a.key.split(',').map(Number) as unknown as FluidPosition,
              b.key.split(',').map(Number) as unknown as FluidPosition,
            ),
          ),
        writes: writes.sort((a, b) => compare(a.position, b.position)),
        consumedFrontier: snapshot.frontier.map((p) => [...p] as FluidPosition),
        consumedCleanupFrontier: (snapshot.cleanupFrontier ?? []).map((p) => [...p] as FluidPosition),
        nextFrontier: [...next.values()].sort(compare),
        nextCleanupFrontier: [],
        needsRescan: header[1] !== 0,
      };
    } catch {
      kernel.failed = true;
      return fallback(snapshot);
    }
  };
}
