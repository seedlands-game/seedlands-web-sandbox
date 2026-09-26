import type { WorldCommitResult } from '../game-server-types';
import type { AuthorityMeshPayload } from '../protocol/authority-worker-protocol';
import { voxelGeometryForComposition } from '../gameplay/modules/voxel-geometry-module';
import { queueBodyRecoveriesAfterCommit } from './authority-geometry-recovery';
import { prepareAuthorityMeshPayload } from './authority-mesh-payload';
import type { AuthorityRuntimeOptions } from './authority-runtime-options';
import type { AuthoritySessionOptions } from './authority-session-options';
import type { AuthoritySession } from './authority-session';
import { VoxelCollisionWorld } from './voxel-collision-world';
import type { GameServer } from '../game-server';

export function assertAuthorityRuntimeGeometry(options: AuthorityRuntimeOptions): void {
  const geometry = voxelGeometryForComposition(options.composition);
  if (options.voxelGeometry !== undefined && options.voxelGeometry !== geometry)
    throw new TypeError('Authority voxel geometry must be the active composition capability instance.');
}

export const createAuthorityCollisionWorld = (options: AuthoritySessionOptions): VoxelCollisionWorld =>
  new VoxelCollisionWorld(
    options.voxelSource,
    options.requestUnknownChunk,
    options.voxelSemantics,
    options.voxelGeometry,
  );

export const prepareAuthorityRuntimeMesh = (
  server: GameServer,
  now: () => number,
  cx: number,
  cy: number,
  cz: number,
): Promise<AuthorityMeshPayload> => prepareAuthorityMeshPayload(server, now, cx, cy, cz, server.voxelGeometry?.list());

export function queueAuthorityRuntimeRecoveries(
  commit: WorldCommitResult,
  server: GameServer,
  session: AuthoritySession,
): void {
  queueBodyRecoveriesAfterCommit(
    commit,
    server.queryEntities(),
    (entityId, maxDistance) => session.requestBodyRecovery(entityId, 'external-geometry-change', maxDistance),
    server.voxelGeometry,
  );
}
