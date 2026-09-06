import type { AuthorityMeshPayload } from '../../worker/authority-worker-protocol';
import { legacyFluid } from '../../server/fluid/fluid-cell-state';
import type { AuthorityCachedMesh, AuthorityCachedPreparation } from './browser-authority-client-contract';
import {
  cacheAuthorityCollisionBaseline,
  type AuthorityCollisionBaselineLease,
  type AuthorityCollisionRevisionGuard,
} from './authority-collision-mirror';

export function acceptAuthorityMeshPreparation(
  payload: AuthorityMeshPayload,
  expectedKey: string,
  chunks: Map<string, AuthorityCachedMesh>,
  guard: AuthorityCollisionRevisionGuard,
  lease: AuthorityCollisionBaselineLease,
): AuthorityCachedPreparation | null {
  if (payload.key !== expectedKey || !guard.accepts(expectedKey, payload.chunkRevision, lease)) return null;
  const canonical = payload.canonical ? new Uint16Array(payload.canonical) : undefined;
  const fluid = payload.fluid ? new Uint8Array(payload.fluid) : undefined;
  const prepared: AuthorityCachedPreparation = {
    payload,
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
