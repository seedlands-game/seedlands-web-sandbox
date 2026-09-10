import {
  assembleProductPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
  type ProductExtensionAdmission,
  type VerifiedPackArtifact,
} from '@seedlands/game-core/server/composition/host-api';
import {
  WorldResourceAuthorizer,
  type WorldAuthorizationPolicy,
} from '@seedlands/game-core/server/harness/world-authorization';
export function createBrowserAuthorityComposition(
  artifacts: readonly VerifiedPackArtifact[],
  approvedExtensions: readonly ProductExtensionAdmission[],
  developerPolicy?: WorldAuthorizationPolicy,
) {
  const composition = assembleProductPacks(artifacts, { approvedExtensions });
  return {
    composition,
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, {
      playerAlias: 'browser-player',
      scriptAuthorization: developerPolicy
        ? new WorldResourceAuthorizer(developerPolicy, composition.resources)
        : undefined,
    }),
  };
}

export function disposeBrowserAuthorityWorker(resources: {
  interval: ReturnType<typeof setInterval> | null;
  persistence: { dispose(): void } | null;
  bootstrap: { close(): void };
  directLogic: { close(): void };
  characterAuthority: { clear(): void } | null;
  runtime: { server: { disposeGameplay(): void } } | null;
}): void {
  if (resources.interval !== null) clearInterval(resources.interval);
  resources.persistence?.dispose();
  resources.bootstrap.close();
  resources.directLogic.close();
  resources.characterAuthority?.clear();
  resources.runtime?.server.disposeGameplay();
}
