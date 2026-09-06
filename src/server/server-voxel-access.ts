import { CHUNK_SIZE, chunkKey, floorDiv, mod, voxelIndex } from '../world/voxel';
import type { ServerChunk } from './game-server-types';
import { peekLoadedVoxel } from './loaded-voxel-reader';

export const readCanonicalVoxel = (
  getChunk: (cx: number, cy: number, cz: number) => ServerChunk,
  x: number,
  y: number,
  z: number,
) => {
  const chunk = getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
  return chunk.voxels[voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE))];
};

export const createLoadedGameplayVoxelReader =
  (chunks: ReadonlyMap<string, ServerChunk>, onUnknownChunk?: (key: string) => void) =>
  (x: number, y: number, z: number): number | undefined => {
    const loaded = peekLoadedVoxel(chunks, x, y, z);
    if (loaded) return loaded.voxel;
    onUnknownChunk?.(chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)));
    return undefined;
  };
