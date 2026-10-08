import type { AuthoritySnapshot } from '@seedlands/stdlib/server/authority/authority-session';

/** Estimate input scheduling only, using the browser realms' shared absolute monotonic clock. */
export function inputSchedulingTick(
  snapshot: Pick<AuthoritySnapshot, 'physicsTick' | 'paused'>,
  physicsHz: 30 | 60 | 120,
  capturedAtTimeOriginMs: number | undefined,
  nowTimeOriginMs: number,
): number {
  if (snapshot.paused || capturedAtTimeOriginMs === undefined) return snapshot.physicsTick;
  const ageMs = nowTimeOriginMs - capturedAtTimeOriginMs;
  if (!Number.isFinite(capturedAtTimeOriginMs) || capturedAtTimeOriginMs < 0 || !Number.isFinite(ageMs) || ageMs < 0)
    return snapshot.physicsTick;
  const tick = snapshot.physicsTick + Math.floor((Math.min(ageMs, 2_000) * physicsHz) / 1_000);
  return Number.isSafeInteger(tick) ? tick : snapshot.physicsTick;
}

/** Updated only after the client's epoch/order gate accepts a snapshot. */
export class BrowserInputSchedulingClock {
  private snapshot: Pick<AuthoritySnapshot, 'physicsTick' | 'paused'> | null = null;
  private capturedAtTimeOriginMs: number | undefined;

  accept(snapshot: AuthoritySnapshot, capturedAtTimeOriginMs?: number): void {
    this.snapshot = snapshot;
    this.capturedAtTimeOriginMs = capturedAtTimeOriginMs;
  }

  tick(physicsHz: 30 | 60 | 120): number {
    return this.snapshot
      ? inputSchedulingTick(
          this.snapshot,
          physicsHz,
          this.capturedAtTimeOriginMs,
          performance.timeOrigin + performance.now(),
        )
      : 0;
  }
}
