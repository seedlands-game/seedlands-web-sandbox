import type { AuthorityReady } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { createVoxelSemanticsRegistry } from '@seedlands/stdlib/world/voxel-semantics';
import { validateVoxelGeometrySemantics } from '@seedlands/stdlib/world/mesh-semantics';
import { createVoxelGeometryRegistryV1, type VoxelGeometryRegistryV1 } from '@seedlands/stdlib/mod-api';

const registries = new WeakMap<AuthorityReady, VoxelGeometryRegistryV1>();

export function validateAuthorityReadyGeometry(ready: AuthorityReady): AuthorityReady {
  if (!ready.voxelGeometry) return ready;
  const semantics = createVoxelSemanticsRegistry(ready.voxelSemantics ?? []);
  const geometry = createVoxelGeometryRegistryV1(ready.voxelGeometry);
  validateVoxelGeometrySemantics(semantics, geometry);
  const normalized = { ...ready, voxelGeometry: geometry.list() };
  registries.set(normalized, geometry);
  return normalized;
}

export function tryValidateAuthorityReadyGeometry(
  ready: AuthorityReady,
  reject: (error: Error) => void,
): AuthorityReady | null {
  try {
    return validateAuthorityReadyGeometry(ready);
  } catch (error) {
    reject(error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

export function validateInitialAuthorityReadyGeometry(
  ready: AuthorityReady,
  fail: (error: Error) => void,
): AuthorityReady | null {
  return tryValidateAuthorityReadyGeometry(ready, fail);
}

export function validateRestoredAuthorityReadyGeometry(
  ready: AuthorityReady,
  requestId: number,
  reject: (requestId: number, error: Error) => void,
): AuthorityReady | null {
  return tryValidateAuthorityReadyGeometry(ready, (error) => reject(requestId, error));
}

export const voxelGeometryForAuthorityReady = (ready: AuthorityReady | null): VoxelGeometryRegistryV1 | undefined =>
  ready ? registries.get(ready) : undefined;
