import { PROTOCOL_VERSION } from '@seedlands/stdlib/runtime/session-protocol';
import type { AuthorityResponse } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';

export function postAuthorityFatal(post: (message: AuthorityResponse) => void, epoch: string, error: unknown) {
  post({
    kind: 'authority-fatal',
    protocolVersion: PROTOCOL_VERSION,
    epoch,
    error: error instanceof Error ? error.message : String(error),
  });
}
