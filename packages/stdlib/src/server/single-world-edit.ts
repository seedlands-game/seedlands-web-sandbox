import { CHUNK_SIZE, Voxel, floorDiv, mod, remeshChunkKeysForEdit, voxelIndex } from '../world/voxel';
import type { ServerChunk, VoxelRegionChanged, WorldCommitResult, WorldSemanticEvent } from './game-server-types';
import { compareChunkKeys } from './world-transaction-commit';
import { SINGLE_EDIT_METRICS, SINGLE_EDIT_NOOP_METRICS } from './world-edit-metrics';

const EMPTY_SEMANTIC_EVENTS: readonly WorldSemanticEvent[] = Object.freeze([]);

export function commitSingleWorldEdit(options: {
  actorId: string;
  x: number;
  y: number;
  z: number;
  value: number;
  worldRevision: number;
  getChunk(cx: number, cy: number, cz: number): ServerChunk;
  setWorldRevision(revision: number): void;
  addMutationCount(count: number): void;
}): WorldCommitResult {
  const { actorId, x, y, z, value } = options;
  const chunk = options.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
  const result = createSingleWorldEditResult({ actorId, x, y, z, value, worldRevision: options.worldRevision, chunk });
  if (!result.committed) return result;
  const index = voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE));
  chunk.voxels[index] = value;
  chunk.revision += 1;
  chunk.dirty = true;
  chunk.materialized = true;
  options.setWorldRevision(result.worldRevision);
  options.addMutationCount(1);
  return result;
}

/** Pure candidate result shared by immediate and prepared host edits. */
export function createSingleWorldEditResult(options: {
  actorId: string;
  x: number;
  y: number;
  z: number;
  value: number;
  worldRevision: number;
  chunk: ServerChunk;
}): WorldCommitResult {
  const { actorId, x, y, z, value, chunk } = options;
  const index = voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE));
  if (chunk.voxels[index] === value)
    return {
      committed: false,
      worldRevision: options.worldRevision,
      structuralChange: null,
      semanticEvents: EMPTY_SEMANTIC_EVENTS,
      metrics: SINGLE_EDIT_NOOP_METRICS,
    };
  const worldRevision = options.worldRevision + 1;
  const meshChunks = remeshChunkKeysForEdit(x, y, z);
  if (meshChunks.length > 1) meshChunks.sort(compareChunkKeys);
  const structuralChange: VoxelRegionChanged = {
    type: 'voxel-region-changed',
    actorId,
    worldRevision,
    mutationCount: 1,
    chunks: [chunk.key],
    chunkRevisions: [{ key: chunk.key, revision: chunk.revision + 1 }],
    meshChunks,
    bounds: { min: [x, y, z], max: [x, y, z] },
  };
  const previousRevision = chunk.revision;
  return {
    committed: true,
    worldRevision,
    structuralChange,
    semanticEvents: EMPTY_SEMANTIC_EVENTS,
    collisionDelta: [
      {
        key: chunk.key,
        previousRevision,
        revision: chunk.revision + 1,
        cells: [{ index, voxel: value, fluid: value === Voxel.Water ? 0x88 : 0 }],
      },
    ],
    metrics: SINGLE_EDIT_METRICS[meshChunks.length],
  };
}
