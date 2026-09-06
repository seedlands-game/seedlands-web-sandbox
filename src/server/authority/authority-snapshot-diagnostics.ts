import type { AuthorityResidencyDiagnostics } from './authority-residency-runtime';
import type { AuthoritySnapshot } from './authority-session-types';

export const withAuthorityResidencyDiagnostics = (
  snapshot: AuthoritySnapshot,
  residency: AuthorityResidencyDiagnostics,
): AuthoritySnapshot => ({
  ...snapshot,
  diagnostics: {
    recoveryResults: snapshot.diagnostics?.recoveryResults ?? [],
    ...(snapshot.diagnostics ?? {}),
    residency,
  },
});
