import { remeshChunkKeysForEdit } from '../../world/voxel';
import type { ServerChunk, VoxelRegionChanged, WorldCommitMetrics, WorldCommitResult } from '../game-server-types';
import { compareChunkKeys } from '../world-transaction-commit';

export function commitFluidMetadata(options: {
  actorId: string;
  x: number;
  y: number;
  z: number;
  chunk: ServerChunk;
  worldRevision: number;
  metrics: (meshChunkCount: number) => WorldCommitMetrics;
}): { result: WorldCommitResult; worldRevision: number } {
  const { actorId, x, y, z, chunk } = options;
  const worldRevision = options.worldRevision + 1;
  const meshChunks = remeshChunkKeysForEdit(x, y, z).sort(compareChunkKeys);
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
  chunk.revision += 1;
  chunk.dirty = true;
  chunk.materialized = true;
  return {
    worldRevision,
    result: {
      committed: true,
      worldRevision,
      structuralChange,
      semanticEvents: [],
      metrics: options.metrics(meshChunks.length),
    },
  };
}
