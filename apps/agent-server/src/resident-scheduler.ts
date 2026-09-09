export type ResidentWake = Readonly<{ source: string; episode: number; reason: string }>;
export type ResidentTrigger = Readonly<{ kind: 'event' | 'fallback'; reasons: readonly string[] }>;
export type ResidentScheduleSnapshot = Readonly<{
  version: 1;
  fallbackSeconds: number;
  remainingMs: number;
  paused: boolean;
  blocked: boolean;
  inFlight: boolean;
  pendingReasons: readonly string[];
  episodes: readonly (readonly [string, number])[];
}>;
type Clock = Readonly<{
  now(): number;
  set(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clear(handle: ReturnType<typeof setTimeout>): void;
}>;
type Options = Readonly<{
  fallbackSeconds?: number;
  restored?: ResidentScheduleSnapshot;
  clock?: Clock;
  dispatch(trigger: ResidentTrigger): { accepted: boolean; completion: Promise<void> };
  onError?(error: unknown): void;
}>;

const systemClock: Clock = {
  now: () => performance.now(),
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle),
};
const validatePeriod = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 60 || seconds > 600)
    throw new RangeError('Fallback interval must be 60–600 seconds');
  return seconds * 1000;
};

/** Domain wake policy. HTTP retries, tool repair and compression never start a new logical round here. */
export class ResidentScheduler {
  private readonly clock: Clock;
  private fallbackMs: number;
  private dueAt: number;
  private pausedRemaining = 0;
  private paused = false;
  private blocked = false;
  private inFlight = false;
  private recoveryRequired = false;
  private restoredBlocked = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private debounceAt: number | null = null;
  private readonly pending = new Set<string>();
  private readonly episodes = new Map<string, number>();

  constructor(private readonly options: Options) {
    this.clock = options.clock ?? systemClock;
    this.fallbackMs = validatePeriod(options.restored?.fallbackSeconds ?? options.fallbackSeconds ?? 180);
    this.dueAt = this.clock.now() + this.fallbackMs;
    if (options.restored) {
      const saved = options.restored;
      if (
        saved.version !== 1 ||
        !Number.isFinite(saved.remainingMs) ||
        saved.remainingMs < 0 ||
        saved.remainingMs > this.fallbackMs ||
        saved.pendingReasons.length > 32 ||
        saved.episodes.length > 128
      )
        throw new TypeError('Invalid wake schedule snapshot');
      this.paused = saved.paused;
      this.restoredBlocked = saved.blocked;
      this.recoveryRequired = saved.inFlight;
      // Recovery owns the journal first; no callback may run from an uncertain snapshot.
      this.blocked = saved.blocked || this.recoveryRequired;
      this.pausedRemaining = saved.remainingMs;
      this.dueAt = this.clock.now() + saved.remainingMs;
      for (const reason of saved.pendingReasons) {
        if (typeof reason !== 'string' || !reason.length || reason.length > 160)
          throw new TypeError('Invalid wake reason');
        this.pending.add(reason);
      }
      for (const [source, episode] of saved.episodes) {
        this.validateWake({ source, episode, reason: 'restore' });
        if (this.episodes.has(source)) throw new TypeError('Duplicate wake source');
        this.episodes.set(source, episode);
      }
      if (this.pending.size) this.debounceAt = this.clock.now() + 250;
    }
    this.schedule();
  }

  notify(wake: ResidentWake): void {
    if (this.disposed) return;
    this.validateWake(wake);
    if ((this.episodes.get(wake.source) ?? -1) >= wake.episode) return;
    if (!this.episodes.has(wake.source) && this.episodes.size >= 128)
      throw new RangeError('Wake source budget exceeded');
    this.episodes.set(wake.source, wake.episode);
    if (this.pending.size < 31) this.pending.add(wake.reason);
    else this.pending.add('Additional world events are available in the current event window.');
    this.debounceAt ??= this.clock.now() + 250;
    this.schedule();
  }

  configure(seconds: number): void {
    const nextPeriod = validatePeriod(seconds);
    const elapsed = this.fallbackMs - this.remaining();
    this.fallbackMs = nextPeriod;
    this.pausedRemaining = Math.max(0, nextPeriod - elapsed);
    this.dueAt = this.clock.now() + this.pausedRemaining;
    this.schedule();
  }

  block(): void {
    this.blocked = true;
    this.cancelTimer();
  }
  unblock(): void {
    if (this.recoveryRequired) return;
    this.blocked = false;
    this.schedule();
  }

  needsRecovery(): boolean {
    return this.recoveryRequired;
  }

  /** Journal recovery must complete before this reset; activation is deliberately a separate step. */
  finishRecovery(): void {
    if (!this.recoveryRequired) return;
    this.recoveryRequired = false;
    this.blocked = this.restoredBlocked;
  }

  activateRecovered(): void {
    if (this.recoveryRequired) throw new Error('Interrupted scheduler journal has not been recovered');
    this.schedule();
  }

  pause(): void {
    if (this.paused || this.disposed) return;
    this.pausedRemaining = this.remaining();
    this.paused = true;
    this.cancelTimer();
  }

  resume(): void {
    if (!this.paused || this.disposed) return;
    this.paused = false;
    this.dueAt = this.clock.now() + this.pausedRemaining;
    if (this.pending.size) this.debounceAt = this.clock.now() + 250;
    this.schedule();
  }

  snapshot(): ResidentScheduleSnapshot {
    return {
      version: 1,
      fallbackSeconds: this.fallbackMs / 1000,
      remainingMs: this.remaining(),
      paused: this.paused,
      blocked: this.blocked,
      inFlight: this.inFlight || this.recoveryRequired,
      pendingReasons: [...this.pending],
      episodes: [...this.episodes],
    };
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
  }

  settleStopped(): void {
    if (!this.disposed) throw new Error('Scheduler must be stopped before settlement');
    this.inFlight = false;
  }

  private validateWake(wake: ResidentWake) {
    if (
      typeof wake.source !== 'string' ||
      !wake.source.length ||
      wake.source.length > 128 ||
      !Number.isSafeInteger(wake.episode) ||
      wake.episode < 0 ||
      typeof wake.reason !== 'string' ||
      !wake.reason.length ||
      wake.reason.length > 160
    )
      throw new TypeError('Invalid wake episode');
  }

  private remaining() {
    return this.paused ? this.pausedRemaining : Math.max(0, this.dueAt - this.clock.now());
  }
  private cancelTimer() {
    if (this.timer !== null) this.clock.clear(this.timer);
    this.timer = null;
  }

  private schedule() {
    this.cancelTimer();
    if (this.disposed || this.paused || this.blocked || this.inFlight) return;
    const next = Math.min(this.dueAt, this.debounceAt ?? Infinity);
    this.timer = this.clock.set(() => void this.fire(), Math.max(0, next - this.clock.now()));
  }

  private async fire() {
    this.timer = null;
    if (this.disposed || this.paused || this.blocked || this.inFlight) return;
    const now = this.clock.now();
    if (now < this.dueAt && (this.debounceAt === null || now < this.debounceAt)) return this.schedule();
    const reasons = [...this.pending];
    this.inFlight = true;
    try {
      const admission = this.options.dispatch({ kind: reasons.length ? 'event' : 'fallback', reasons });
      if (admission.accepted) {
        for (const reason of reasons) this.pending.delete(reason);
        this.debounceAt = null;
        this.dueAt = now + this.fallbackMs;
        if (this.paused) this.pausedRemaining = this.fallbackMs;
      } else {
        // A rejected admission needs an explicit owner wake; a zero remaining deadline must not spin.
        this.blocked = true;
      }
      await admission.completion;
    } catch (error) {
      this.blocked = true;
      this.options.onError?.(error);
    } finally {
      this.inFlight = false;
      if (this.pending.size) this.debounceAt ??= this.clock.now() + 250;
      this.schedule();
    }
  }
}
