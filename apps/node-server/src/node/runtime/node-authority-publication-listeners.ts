import type { NodeAuthorityPublication } from './node-authority-lane';

export type AuthorityPublicationListener = ((publication: Readonly<NodeAuthorityPublication>) => void) &
  Readonly<{ onFailure?: (error: Error) => void }>;

/** A consumer owns its transport failure. Publication fan-out must never fail the authority lane. */
export function notifyAuthorityPublicationListeners(
  listeners: ReadonlySet<AuthorityPublicationListener>,
  publication: Readonly<NodeAuthorityPublication>,
): void {
  for (const listener of listeners) {
    try {
      listener(structuredClone(publication));
    } catch (error) {
      listener.onFailure?.(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
