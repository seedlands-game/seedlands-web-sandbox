import { gameplayContentForComposition, worldgenProviderForComposition } from '@seedlands/stdlib/host';
import { AuthorityRuntime } from '@seedlands/stdlib/server/authority/authority-runtime';
import type { AuthorityRuntimeOptions } from '@seedlands/stdlib/server/authority/authority-runtime-options';
import type { ProductExtensionAdmission, VerifiedPackArtifact } from '@seedlands/stdlib/server/composition/host-api';
import { browserCorePlatform } from '../platform/core-platform';
import { createBrowserAuthorityComposition } from './authority-worker-runtime-lifecycle';

export function prepareBrowserAuthorityWorldgen(
  packArtifacts: readonly VerifiedPackArtifact[],
  approvedExtensions: readonly ProductExtensionAdmission[],
  developerPolicy: Parameters<typeof createBrowserAuthorityComposition>[2],
) {
  const assembly = createBrowserAuthorityComposition(packArtifacts, approvedExtensions, developerPolicy);
  return {
    assembly,
    worldgenProvider: worldgenProviderForComposition(assembly.composition),
    starterEcology: gameplayContentForComposition(assembly.composition).actorProfiles.starterEcology,
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
  return AuthorityRuntime.create({
    ...prepared.assembly,
    ...options,
    worldgenProvider: prepared.worldgenProvider,
    startTimeMs: 0,
    startClock: browserCorePlatform.now,
    platform: browserCorePlatform,
  });
}
