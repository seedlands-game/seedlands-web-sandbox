import { CHUNK_SIZE, Voxel, chunkKey, floorDiv, mod, voxelIndex } from '../../world/voxel';
import type { ServerChunk, WorldEditBatch } from '../game-server-types';
import { hasAdjacentWater } from './fluid-cell-state';
import type { FluidCellValue, FluidChunkSnapshot, FluidPosition } from './fluid-transaction';
import type { FluidCell } from './voxel-fluid-runtime';

export type PreviousFluidState = { x: number; y: number; z: number; voxel: number; cell: FluidCell | null };

export function readFluidChunk(
  key: string,
  allowsKey: (key: string) => boolean,
  chunks: ReadonlyMap<string, ServerChunk>,
): FluidChunkSnapshot | null {
  if (!allowsKey(key)) return null;
  const chunk = chunks.get(key);
  return chunk
    ? {
        key: chunk.key,
        cx: chunk.cx,
        cy: chunk.cy,
        cz: chunk.cz,
        revision: chunk.revision,
        voxels: chunk.voxels,
        fluid: chunk.fluid,
      }
    : null;
}

export function readFluidCell(
  [x, y, z]: FluidPosition,
  allowsPosition: (x: number, y: number, z: number) => boolean,
  chunks: ReadonlyMap<string, ServerChunk>,
): FluidCellValue | null {
  if (!allowsPosition(x, y, z)) return null;
  const chunk = chunks.get(chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)));
  if (!chunk) return null;
  const index = voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE));
  return { voxel: chunk.voxels[index], fluid: chunk.fluid[index] };
}

export function captureBatchFluidState(
  batch: WorldEditBatch,
  callbacks: {
    getVoxel(x: number, y: number, z: number): number;
    getCell(x: number, y: number, z: number): FluidCell | null;
  },
): Map<string, PreviousFluidState> {
  const previous = new Map<string, PreviousFluidState>();
  const remember = (x: number, y: number, z: number) => {
    const key = `${x},${y},${z}`;
    if (previous.has(key)) return;
    const voxel = callbacks.getVoxel(x, y, z);
    previous.set(key, { x, y, z, voxel, cell: voxel === Voxel.Water ? callbacks.getCell(x, y, z) : null });
  };
  batch.edits?.forEach((edit) => remember(edit.x, edit.y, edit.z));
  batch.buffers?.forEach((buffer) => buffer.forEach((x, y, z) => remember(x, y, z)));
  return previous;
}

export function commitBatchFluidSidecars(
  previous: ReadonlyMap<string, PreviousFluidState>,
  callbacks: {
    getVoxel(x: number, y: number, z: number): number;
    includeEditedPosition(x: number, y: number, z: number): void;
    writeCell(x: number, y: number, z: number, cell: FluidCell | null): boolean;
    peekVoxel(x: number, y: number, z: number): number | undefined;
    activate(position: [number, number, number]): boolean;
    removeSource(position: [number, number, number]): boolean;
  },
): void {
  for (const state of previous.values()) {
    const value = callbacks.getVoxel(state.x, state.y, state.z);
    if (value === state.voxel) continue;
    callbacks.includeEditedPosition(state.x, state.y, state.z);
    callbacks.writeCell(state.x, state.y, state.z, value === Voxel.Water ? { level: 8, source: true } : null);
    if (
      state.voxel === Voxel.Water ||
      value === Voxel.Water ||
      hasAdjacentWater(callbacks.peekVoxel, state.x, state.y, state.z)
    )
      callbacks.activate([state.x, state.y, state.z]);
    if (state.cell?.source && value !== Voxel.Water) callbacks.removeSource([state.x, state.y, state.z]);
  }
}
