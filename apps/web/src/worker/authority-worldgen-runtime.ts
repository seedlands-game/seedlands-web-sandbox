import { gameplayContentForComposition, worldgenProviderForComposition } from '@seedlands/stdlib/host';
import { AuthorityRuntime } from '@seedlands/stdlib/server/authority/authority-runtime';
import type { AuthorityRuntimeOptions } from '@seedlands/stdlib/server/authority/authority-runtime-options';
import type {
  ProductExtensionAdmission,
  ProductPackAdmission,
  VerifiedPackArtifact,
} from '@seedlands/stdlib/server/composition/host-api';
import { browserCorePlatform } from '../platform/core-platform';
import { createBrowserAuthorityComposition } from './authority-worker-runtime-lifecycle';
import type { VoxelSemanticsRegistry } from '@seedlands/stdlib/world/voxel-semantics';
import { voxelGeometryForComposition } from '@seedlands/stdlib/mod-api';
import { assertBrowserGameplayProvenance } from '../client/persistence/legacy-gameplay-provenance-error';

type BrowserGameplaySnapshotSource = Readonly<{ loadGameplaySnapshot?(): unknown; dispose?(): void }>;

export const readBrowserAuthorityGameplaySnapshot = (source: BrowserGameplaySnapshotSource | undefined): unknown => {
  const snapshot = source?.loadGameplaySnapshot?.() ?? null;
  assertBrowserGameplayProvenance(snapshot);
  return snapshot;
};

export function prepareBrowserAuthorityWorldgen(
  packArtifacts: readonly VerifiedPackArtifact[],
  approvedPlaybook: ProductPackAdmission,
  approvedExtensions: readonly ProductExtensionAdmission[],
  developerPolicy: Parameters<typeof createBrowserAuthorityComposition>[3],
) {
  const assembly = createBrowserAuthorityComposition(
    packArtifacts,
    approvedPlaybook,
    approvedExtensions,
    developerPolicy,
  );
  return {
    assembly,
    worldgenProvider: worldgenProviderForComposition(assembly.composition),
    starterEcology: gameplayContentForComposition(assembly.composition).actorProfiles.starterEcology,
    voxelSemantics: assembly.composition.capability<VoxelSemanticsRegistry>('seedlands:voxel-semantics').list(),
    voxelGeometry: voxelGeometryForComposition(assembly.composition),
  };
}

export function createBrowserAuthorityRuntime(
  prepared: ReturnType<typeof prepareBrowserAuthorityWorldgen>,
  options: Omit<
    AuthorityRuntimeOptions,
    | 'platform'
    | 'startTimeMs'
    | 'startClock'
    | 'worldgenProvider'
    | 'legacyCompositionIdentity'
    | 'composition'
    | 'moduleSystemAuthority'
    | 'moduleActorAuthority'
  >,
) {
  try {
    readBrowserAuthorityGameplaySnapshot(options.persistence);
  } catch (error) {
    (options.persistence as BrowserGameplaySnapshotSource | undefined)?.dispose?.();
    throw error;
  }
  return AuthorityRuntime.create({
    ...prepared.assembly,
    ...options,
    worldgenProvider: prepared.worldgenProvider,
    voxelGeometry: prepared.voxelGeometry,
    startTimeMs: 0,
    startClock: browserCorePlatform.now,
    platform: browserCorePlatform,
  });
}
