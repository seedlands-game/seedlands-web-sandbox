import { CHUNK_SIZE, chunkKey, floorDiv, mod, voxelIndex } from '../../world/voxel';
import type { ServerChunk } from '../game-server-types';
import { fluidCellInChunk, writeFluidCellInChunk } from './fluid-cell-state';
import type { FluidCell } from './voxel-fluid-runtime';

export class FluidChunkAccess {
  constructor(
    private readonly chunks: Map<string, ServerChunk>,
    private readonly loadChunk: (cx: number, cy: number, cz: number) => ServerChunk,
  ) {}

  peekVoxel(x: number, y: number, z: number): number | undefined {
    const chunk = this.chunks.get(chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)));
    return chunk?.voxels[voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE))];
  }

  cell(x: number, y: number, z: number, load: boolean): FluidCell | null {
    const coords = [floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)] as const;
    const chunk = load ? this.loadChunk(...coords) : this.chunks.get(chunkKey(...coords));
    return fluidCellInChunk(chunk, mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE));
  }

  write(x: number, y: number, z: number, cell: FluidCell | null): boolean {
    const chunk = this.loadChunk(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
    return writeFluidCellInChunk(chunk, mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE), cell);
  }
}
