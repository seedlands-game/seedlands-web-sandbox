import type { AuthoritySnapshot } from '@seedlands/stdlib/server/authority/authority-session';
import type { AuthoritySessionControlResult } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';

export async function controlAuthoritySession<Paused extends boolean>(
  paused: Paused,
  request: () => Promise<unknown>,
  acceptSnapshot: (snapshot: AuthoritySnapshot) => void,
  fail: (error: Error) => void,
): Promise<{ paused: Paused }> {
  try {
    const result = (await request()) as Partial<AuthoritySessionControlResult>;
    if (result.paused !== paused || !result.snapshot || result.snapshot.paused !== paused)
      throw new Error('Authority session control acknowledgement is invalid.');
    acceptSnapshot(result.snapshot);
    return { paused };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    fail(failure);
    throw failure;
  }
}
