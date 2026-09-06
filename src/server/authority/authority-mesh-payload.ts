import type { AuthorityMeshPayload } from '../../worker/authority-worker-protocol';
import type { GameServer } from '../game-server';

export async function prepareAuthorityMeshPayload(
  server: GameServer,
  now: () => number,
  cx: number,
  cy: number,
  cz: number,
): Promise<AuthorityMeshPayload> {
  const startedAt = now();
  server.retainMeshChunk(cx, cy, cz);
  const persistenceStartedAt = now();
  const persistence = await server.ensureChunkNeighborhood(cx, cy, cz);
  const persistenceWaitMs = now() - persistenceStartedAt;
  const snapshotStartedAt = now();
  const prepared = server.prepareWorkerMeshInput(cx, cy, cz);
  const snapshotCopyMs = now() - snapshotStartedAt;
  return {
    key: prepared.key,
    cx,
    cy,
    cz,
    chunkRevision: prepared.chunkRevision,
    generatorVersion: server.generatorVersion,
    preparationDiagnostics: {
      authorityPrepareMs: now() - startedAt,
      persistenceWaitMs,
      snapshotCopyMs,
      ...(persistence ? { persistence } : {}),
    },
    ...(prepared.canonical ? { canonical: prepared.canonical.buffer as ArrayBuffer } : {}),
    ...(prepared.fluid ? { fluid: prepared.fluid.buffer as ArrayBuffer } : {}),
    overlays: prepared.overlays.map((overlay) => ({
      cx: overlay.cx,
      cy: overlay.cy,
      cz: overlay.cz,
      voxels: overlay.voxels.buffer as ArrayBuffer,
      ...(overlay.fluid ? { fluid: overlay.fluid.buffer as ArrayBuffer } : {}),
    })),
  };
}
