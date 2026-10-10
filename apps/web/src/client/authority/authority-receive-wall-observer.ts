export type AuthorityReceiveWallSnapshot = Readonly<{
  runtimeEpoch: string;
  generation: number;
  count: number;
  totalWallMs: number;
}>;

// Completed synchronous handler wall only: excludes queueing, clone, async continuations and Worker CPU.
export class AuthorityReceiveWallObserver {
  private epoch: string | null = null;
  private generation = 0;
  private count = 0;
  private totalWallMs = 0;
  private depth = 0;
  private lastEnd: number | null = null;
  private readonly now: () => number;

  constructor(
    now: (() => number) | undefined,
    private readonly runtimeEpoch: () => string | null | false,
  ) {
    this.now = now ?? (() => performance.now());
  }

  snapshot(): AuthorityReceiveWallSnapshot | null {
    const epoch = this.runtimeEpoch() || null;
    if (epoch !== this.epoch) this.restart(epoch);
    return epoch === null
      ? null
      : Object.freeze({
          runtimeEpoch: epoch,
          generation: this.generation,
          count: this.count,
          totalWallMs: this.totalWallMs,
        });
  }

  measure<T>(callback: () => T): T {
    if (this.depth) return callback();
    const before = this.snapshot();
    const start = this.readClock();
    this.depth++;
    try {
      return callback();
    } finally {
      this.depth--;
      const end = this.readClock();
      const after = this.snapshot();
      if (before && after && before.runtimeEpoch === after.runtimeEpoch && before.generation === after.generation) {
        const total = this.totalWallMs + end - start;
        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          end < start ||
          (this.lastEnd !== null && start < this.lastEnd) ||
          !Number.isFinite(total) ||
          !Number.isSafeInteger(this.count + 1)
        ) {
          this.restart(after.runtimeEpoch);
        } else {
          this.count++;
          this.totalWallMs = total;
          this.lastEnd = end;
        }
      }
    }
  }

  private readClock(): number {
    try {
      return this.now();
    } catch {
      return NaN;
    }
  }

  private restart(epoch: string | null): void {
    this.epoch = epoch;
    this.generation++;
    this.count = 0;
    this.totalWallMs = 0;
    this.lastEnd = null;
  }
}
