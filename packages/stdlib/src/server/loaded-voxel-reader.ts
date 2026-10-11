import { fluidCellInChunk } from './fluid/fluid-cell-state';
import type { ServerChunk } from './game-server-types';
import type { FluidChunkAccess } from './fluid/fluid-chunk-access';
import { CHUNK_SIZE, chunkKey, floorDiv, mod, voxelIndex } from '../world/voxel';

export function peekLoadedVoxel(chunks: ReadonlyMap<string, ServerChunk>, x: number, y: number, z: number) {
  const key = chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
  const chunk = chunks.get(key);
  if (!chunk) return null;
  const localX = mod(x, CHUNK_SIZE);
  const localY = mod(y, CHUNK_SIZE);
  const localZ = mod(z, CHUNK_SIZE);
  const cell = fluidCellInChunk(chunk, localX, localY, localZ);
  return {
    voxel: chunk.voxels[voxelIndex(localX, localY, localZ)],
    chunkKey: key,
    revision: chunk.revision,
    ...(cell ? { fluid: { level: cell.level } } : {}),
  };
}

/** Read a cell in an already-clipped terrain window without deriving its chunk key again. */
export function peekLoadedVoxelInChunk(
  chunks: ReadonlyMap<string, ServerChunk>,
  key: string,
  x: number,
  y: number,
  z: number,
) {
  const chunk = chunks.get(key);
  if (!chunk) return null;
  const localX = x - chunk.cx * CHUNK_SIZE;
  const localY = y - chunk.cy * CHUNK_SIZE;
  const localZ = z - chunk.cz * CHUNK_SIZE;
  if (
    !Number.isInteger(localX) ||
    !Number.isInteger(localY) ||
    !Number.isInteger(localZ) ||
    localX < 0 ||
    localY < 0 ||
    localZ < 0 ||
    localX >= CHUNK_SIZE ||
    localY >= CHUNK_SIZE ||
    localZ >= CHUNK_SIZE
  )
    return null;
  const cell = fluidCellInChunk(chunk, localX, localY, localZ);
  return {
    voxel: chunk.voxels[voxelIndex(localX, localY, localZ)],
    chunkKey: key,
    revision: chunk.revision,
    ...(cell ? { fluid: { level: cell.level } } : {}),
  };
}

export function readLoadedGameplayCell(
  readVoxel: (x: number, y: number, z: number) => { voxel: number } | null,
  fluidChunks: Pick<FluidChunkAccess, 'cell'>,
  x: number,
  y: number,
  z: number,
) {
  const loaded = readVoxel(x, y, z);
  if (!loaded) return null;
  const fluid = fluidChunks.cell(x, y, z, false);
  return { voxel: loaded.voxel, fluid: fluid ? fluid.level | (fluid.source ? 0x80 : 0) : 0 };
}
