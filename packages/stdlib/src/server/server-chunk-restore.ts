import type { ChunkSnapshot } from './persistence/chunk-persistence';
import type { ServerChunk } from './game-server-types';
import { legacyFluid } from './fluid/fluid-cell-state';

/** Prepared persistence owns the voxel buffer until admission; fluid gets an independent sidecar. */
export function restoreServerChunk(snapshot: ChunkSnapshot, accessEpoch: number): ServerChunk {
  return {
    key: snapshot.key,
    cx: snapshot.cx,
    cy: snapshot.cy,
    cz: snapshot.cz,
    voxels: snapshot.voxels,
    revision: snapshot.revision,
    persistedRevision: snapshot.revision,
    dirty: false,
    materialized: true,
    accessEpoch,
    fluid: snapshot.fluid?.slice() ?? legacyFluid(snapshot.voxels),
  };
}
