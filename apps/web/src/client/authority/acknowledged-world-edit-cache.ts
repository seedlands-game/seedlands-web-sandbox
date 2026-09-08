import type { WorldCommitResult } from '@seedlands/game-core/server/game-server-types';
import type { VoxelEdit } from '@seedlands/game-core/server/world-mutation';
import { CHUNK_SIZE, chunkKey, floorDiv, mod, voxelIndex } from '@seedlands/game-core/world/voxel';

export type MutableAcknowledgedChunk = {
  canonical: Uint16Array;
  chunkRevision: number;
};

export function applyAcknowledgedWorldEdits(
  options: Readonly<{
    edits: readonly VoxelEdit[];
    result: WorldCommitResult;
    getCachedChunk: (key: string) => MutableAcknowledgedChunk | undefined;
  }>,
): void {
  const revisions = new Map(
    options.result.structuralChange?.chunkRevisions.map(({ key, revision }) => [key, revision] as const) ?? [],
  );
  if (revisions.size === 0) return;

  for (const edit of options.edits) {
    const cx = floorDiv(edit.x, CHUNK_SIZE);
    const cy = floorDiv(edit.y, CHUNK_SIZE);
    const cz = floorDiv(edit.z, CHUNK_SIZE);
    const key = chunkKey(cx, cy, cz);
    const acknowledgedRevision = revisions.get(key);
    const cached = options.getCachedChunk(key);
    if (acknowledgedRevision === undefined || !cached || cached.chunkRevision > acknowledgedRevision) continue;
    cached.canonical[voxelIndex(mod(edit.x, CHUNK_SIZE), mod(edit.y, CHUNK_SIZE), mod(edit.z, CHUNK_SIZE))] =
      edit.value;
    cached.chunkRevision = acknowledgedRevision;
  }
}
