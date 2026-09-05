import { createProceduralMeshInput, type MeshAuthorityOverlay } from '../world/mesh';
import { chunkKey } from '../world/voxel';
import type { DerivedMeshSnapshot, ServerChunk, WorkerMeshPreparation } from './game-server-types';

type MeshSnapshotSource = Readonly<{
  seed: number;
  generatorVersion: number;
  getChunk: (cx: number, cy: number, cz: number) => ServerChunk;
  readAuthoritativeChunk: (cx: number, cy: number, cz: number) => ServerChunk | undefined;
}>;

const overlaysFor = (
  source: MeshSnapshotSource,
  cx: number,
  cy: number,
  cz: number,
  copy: boolean,
): MeshAuthorityOverlay[] => {
  const overlays: MeshAuthorityOverlay[] = [];
  for (let overlayY = cy - 1; overlayY <= cy + 1; overlayY += 1)
    for (let overlayZ = cz - 1; overlayZ <= cz + 1; overlayZ += 1)
      for (let overlayX = cx - 1; overlayX <= cx + 1; overlayX += 1) {
        if (overlayX === cx && overlayY === cy && overlayZ === cz) continue;
        const chunk = source.readAuthoritativeChunk(overlayX, overlayY, overlayZ);
        if (!chunk || (copy && !chunk.materialized)) continue;
        overlays.push({
          cx: overlayX,
          cy: overlayY,
          cz: overlayZ,
          voxels: copy ? chunk.voxels.slice() : chunk.voxels,
          fluid: copy ? chunk.fluid.slice() : chunk.fluid,
        });
      }
  return overlays;
};

export function createServerDerivedMeshSnapshot(
  source: MeshSnapshotSource,
  cx: number,
  cy: number,
  cz: number,
): DerivedMeshSnapshot {
  const chunk = source.getChunk(cx, cy, cz);
  const derived = createProceduralMeshInput({
    seed: source.seed,
    generatorVersion: source.generatorVersion,
    cx,
    cy,
    cz,
    canonical: chunk.voxels,
    fluid: chunk.fluid,
    overlays: overlaysFor(source, cx, cy, cz, false),
  });
  return {
    key: chunk.key,
    cx,
    cy,
    cz,
    canonical: chunk.voxels,
    halo: derived.halo,
    fluid: derived.fluid,
    fluidHalo: derived.fluidHalo,
    chunkRevision: chunk.revision,
    haloRevision: derived.haloRevision,
    proceduralVoxelSamples: derived.proceduralVoxelSamples,
    macroContextCount: derived.macroContextCount,
  };
}

export function prepareServerWorkerMeshInput(
  source: MeshSnapshotSource,
  cx: number,
  cy: number,
  cz: number,
): WorkerMeshPreparation {
  const key = chunkKey(cx, cy, cz);
  const center = source.readAuthoritativeChunk(cx, cy, cz);
  return {
    key,
    cx,
    cy,
    cz,
    chunkRevision: center?.revision ?? 0,
    generatorVersion: source.generatorVersion,
    ...(center?.materialized ? { canonical: center.voxels.slice(), fluid: center.fluid.slice() } : {}),
    overlays: overlaysFor(source, cx, cy, cz, true),
  };
}
