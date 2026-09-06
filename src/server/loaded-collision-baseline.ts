import { chunkKey } from '../world/voxel';
import type { AuthorityCollisionBaselineResult, ServerChunk } from './game-server-types';

export function readLoadedCollisionBaseline(
  chunks: ReadonlyMap<string, ServerChunk>,
  key: string,
  minimumRevision: number,
): AuthorityCollisionBaselineResult {
  const coordinates = key.split(',').map(Number);
  if (
    coordinates.length !== 3 ||
    !coordinates.every(Number.isInteger) ||
    chunkKey(...(coordinates as [number, number, number])) !== key
  )
    throw new TypeError(`Collision baseline Chunk key is invalid: ${key}.`);
  if (!Number.isSafeInteger(minimumRevision) || minimumRevision < 0)
    throw new RangeError('Collision baseline minimumRevision must be a non-negative safe integer.');
  const chunk = chunks.get(key);
  if (!chunk || chunk.revision < minimumRevision) return { status: 'unavailable', key };
  return {
    status: 'available',
    key,
    chunkRevision: chunk.revision,
    canonical: chunk.voxels.slice().buffer as ArrayBuffer,
    fluid: chunk.fluid.slice().buffer as ArrayBuffer,
  };
}
