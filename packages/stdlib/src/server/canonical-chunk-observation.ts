import { CanonicalChunkResidency } from './chunk-residency';
import type { ServerChunk } from './game-server-types';
import { chunkKey } from '../world/voxel';

export function canonicalChunkNeighborhoodKeys(cx: number, cy: number, cz: number): string[] {
  const keys: string[] = [];
  for (let y = cy - 1; y <= cy + 1; y += 1)
    for (let z = cz - 1; z <= cz + 1; z += 1) for (let x = cx - 1; x <= cx + 1; x += 1) keys.push(chunkKey(x, y, z));
  return keys;
}

export function hasLoadedCanonicalChunk(chunks: ReadonlyMap<string, ServerChunk>, key: string): boolean {
  const coordinates = key.split(',').map(Number);
  if (
    coordinates.length !== 3 ||
    !coordinates.every(Number.isSafeInteger) ||
    chunkKey(...(coordinates as [number, number, number])) !== key
  )
    throw new TypeError(`Canonical Chunk key is invalid: ${key}.`);
  return chunks.has(key);
}

export function retainCanonicalPreparation(
  residency: CanonicalChunkResidency,
  keys: readonly string[],
  maintain: () => void,
): () => void {
  keys.forEach((key) => residency.retainPreparation(key));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    keys.forEach((key) => residency.releasePreparation(key));
    maintain();
  };
}
