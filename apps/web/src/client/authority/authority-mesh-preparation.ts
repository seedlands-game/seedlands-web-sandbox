import type { AuthorityMeshPayload } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { legacyFluid } from '@seedlands/stdlib/server/fluid/fluid-cell-state';
import type { AuthorityCachedMesh, AuthorityCachedPreparation } from './browser-authority-client-contract';
import {
  cacheAuthorityCollisionBaseline,
  type AuthorityCollisionBaselineLease,
  type AuthorityCollisionRevisionGuard,
} from './authority-collision-mirror';
import { createVoxelGeometryRegistryV1 } from '@seedlands/stdlib/mod-api';
import type { VoxelGeometryDefinitionV1 } from '@seedlands/stdlib/mod-api';
import { createVoxelSemanticsRegistry } from '@seedlands/stdlib/world/voxel-semantics';
import { validateVoxelGeometrySemantics } from '@seedlands/stdlib/world/mesh-semantics';

export function acceptAuthorityMeshPreparation(
  payload: AuthorityMeshPayload,
  expectedKey: string,
  chunks: Map<string, AuthorityCachedMesh>,
  guard: AuthorityCollisionRevisionGuard,
  lease: AuthorityCollisionBaselineLease,
  expectedVoxelGeometry?: readonly VoxelGeometryDefinitionV1[],
): AuthorityCachedPreparation | null {
  if (payload.key !== expectedKey || !guard.accepts(expectedKey, payload.chunkRevision, lease)) return null;
  const geometryRegistry = payload.voxelGeometry ? createVoxelGeometryRegistryV1(payload.voxelGeometry) : undefined;
  if (geometryRegistry) {
    if (!payload.voxelSemantics)
      throw new TypeError('Voxel geometry requires the matching voxel semantics projection.');
    validateVoxelGeometrySemantics(createVoxelSemanticsRegistry(payload.voxelSemantics), geometryRegistry);
  }
  const voxelGeometry = geometryRegistry?.list();
  if (JSON.stringify(voxelGeometry) !== JSON.stringify(expectedVoxelGeometry))
    throw new Error('Authority mesh geometry does not match the active world.');
  const validatedPayload: AuthorityMeshPayload = {
    ...payload,
    ...(voxelGeometry ? { voxelGeometry } : {}),
  };
  const canonical = payload.canonical ? new Uint16Array(payload.canonical) : undefined;
  const fluid = payload.fluid ? new Uint8Array(payload.fluid) : undefined;
  const prepared: AuthorityCachedPreparation = {
    payload: validatedPayload,
    ...(canonical ? { canonical } : {}),
    ...(fluid ? { fluid } : {}),
    overlays: payload.overlays.map((overlay) => ({
      cx: overlay.cx,
      cy: overlay.cy,
      cz: overlay.cz,
      voxels: new Uint16Array(overlay.voxels),
      ...(overlay.fluid ? { fluid: new Uint8Array(overlay.fluid) } : {}),
    })),
  };
  if (canonical)
    cacheAuthorityCollisionBaseline(
      chunks,
      expectedKey,
      {
        canonical: canonical.slice(),
        fluid: fluid?.slice() ?? legacyFluid(canonical),
        chunkRevision: payload.chunkRevision,
      },
      guard,
      lease,
    );
  return prepared;
}
