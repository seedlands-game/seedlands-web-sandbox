import { fluidCellInChunk } from './fluid/fluid-cell-state';
import type { ServerChunk } from './game-server-types';
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
