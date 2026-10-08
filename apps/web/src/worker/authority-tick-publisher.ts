import { PROTOCOL_VERSION } from '@seedlands/stdlib/runtime/session-protocol';
import type { AuthorityRuntime } from '@seedlands/stdlib/server/authority/authority-runtime';
import type { AuthoritySnapshot } from '@seedlands/stdlib/server/authority/authority-session';
import type { AuthorityResponse } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { publishAuthorityMediaBatches } from './authority-media-publisher';

/** Existing periodic snapshot/gameplay/media cadence, independent of worker input servicing. */
export class AuthorityTickPublisher {
  private lastSnapshotAt = Number.NEGATIVE_INFINITY;
  private lastGameplayAt = Number.NEGATIVE_INFINITY;
  reset(): void {
    this.lastSnapshotAt = this.lastGameplayAt = Number.NEGATIVE_INFINITY;
  }
  publish(
    runtime: AuthorityRuntime,
    snapshot: AuthoritySnapshot,
    now: number,
    epoch: string,
    runtimeEpoch: string,
    post: (message: AuthorityResponse) => void,
  ): void {
    if (now - this.lastSnapshotAt < 1000 / 60) return;
    const media = runtime.takeMediaFacts(runtimeEpoch);
    const publishGameplay = media.length > 0 || now - this.lastGameplayAt >= 50;
    const commits = runtime.takeCommits();
    post({
      kind: 'authority-snapshot',
      capturedAtTimeOriginMs: performance.timeOrigin + now,
      protocolVersion: PROTOCOL_VERSION,
      epoch,
      snapshot,
      ...(publishGameplay ? { gameplay: runtime.view() } : {}),
      ...(commits.length ? { commits } : {}),
    });
    publishAuthorityMediaBatches(epoch, media, post);
    this.lastSnapshotAt = now;
    if (publishGameplay) this.lastGameplayAt = now;
  }
}
