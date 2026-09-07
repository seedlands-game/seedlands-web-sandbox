import type { AuthoritySnapshot } from '../../server/authority/authority-session';

export type SnapshotRejectionReason =
  'wrong-epoch' | 'duplicate' | 'physics-tick-regressed' | 'commit-regressed' | 'ack-regressed';

export class AuthoritySnapshotGate {
  private latest: AuthoritySnapshot | null = null;
  private rejectionCounts = new Map<SnapshotRejectionReason, number>();

  constructor(private readonly epoch: string) {}

  accept(snapshot: AuthoritySnapshot): SnapshotRejectionReason | null {
    let reason: SnapshotRejectionReason | null = null;
    if (snapshot.epoch !== this.epoch) reason = 'wrong-epoch';
    else if (this.latest) {
      if (snapshot.physicsTick < this.latest.physicsTick) reason = 'physics-tick-regressed';
      else if (snapshot.commitSequence < this.latest.commitSequence) reason = 'commit-regressed';
      else if (snapshot.acknowledgedInputSequence < this.latest.acknowledgedInputSequence) reason = 'ack-regressed';
      else if (
        snapshot.physicsTick === this.latest.physicsTick &&
        snapshot.commitSequence === this.latest.commitSequence &&
        snapshot.acknowledgedInputSequence === this.latest.acknowledgedInputSequence &&
        snapshot.paused === this.latest.paused
      )
        reason = 'duplicate';
    }
    if (reason) {
      this.rejectionCounts.set(reason, (this.rejectionCounts.get(reason) ?? 0) + 1);
      return reason;
    }
    this.latest = snapshot;
    return null;
  }

  get rejected(): Readonly<Record<SnapshotRejectionReason, number>> {
    return {
      'wrong-epoch': this.rejectionCounts.get('wrong-epoch') ?? 0,
      duplicate: this.rejectionCounts.get('duplicate') ?? 0,
      'physics-tick-regressed': this.rejectionCounts.get('physics-tick-regressed') ?? 0,
      'commit-regressed': this.rejectionCounts.get('commit-regressed') ?? 0,
      'ack-regressed': this.rejectionCounts.get('ack-regressed') ?? 0,
    };
  }
}
