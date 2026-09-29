import { PROTOCOL_VERSION } from '@seedlands/stdlib/runtime/session-protocol';
import type {
  AuthorityResponse,
  MediaPlaybackCommittedBatchV1,
} from '@seedlands/stdlib/server/protocol/authority-worker-protocol';

export function publishPendingAuthorityMediaFacts(
  outerEpoch: string,
  runtimeEpoch: string,
  source: Readonly<{ takeMediaFacts(worldEpoch: string): readonly MediaPlaybackCommittedBatchV1[] }>,
  post: (message: AuthorityResponse) => void,
): number {
  const batches = source.takeMediaFacts(runtimeEpoch);
  publishAuthorityMediaBatches(outerEpoch, batches, post);
  return batches.length;
}

export function publishAuthorityMediaBatches(
  outerEpoch: string,
  batches: readonly MediaPlaybackCommittedBatchV1[],
  post: (message: AuthorityResponse) => void,
): void {
  for (const batch of batches)
    post({ kind: 'authority-media-facts', protocolVersion: PROTOCOL_VERSION, epoch: outerEpoch, batch });
}
