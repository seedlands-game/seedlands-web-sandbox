export type SchedulerTrigger = Readonly<{ kind: 'event' | 'fallback'; reasons: readonly string[] }>;

export type SchedulerDispatch = Readonly<{
  dispatched: boolean;
  completion: Promise<void>;
  retryAfterMs?: number;
}>;

export type SchedulerClock = Readonly<{
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
}>;

export type CognitionSchedulerOptions = Readonly<{
  fallbackSeconds?: number;
  debounceMs?: number;
  clock?: SchedulerClock;
  dispatch: (trigger: SchedulerTrigger) => SchedulerDispatch;
}>;

const systemClock: SchedulerClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
};

export function validateFallbackSeconds(value: number): number {
  if (!Number.isFinite(value) || value < 60 || value > 600)
    throw new Error('fallbackSeconds must be between 60 and 600');
  return value;
}

export class CognitionScheduler {
  private readonly clock: SchedulerClock;
  private fallbackMs: number;
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dueAt = 0;
  private remainingMs = 0;
  private paused = false;
  private disposed = false;
  private inFlight = false;
  private pendingEventReasons = new Set<string>();
  private debounceDueAt: number | null = null;

  constructor(private readonly options: CognitionSchedulerOptions) {
    this.clock = options.clock ?? systemClock;
    this.fallbackMs = validateFallbackSeconds(options.fallbackSeconds ?? 180) * 1000;
    this.debounceMs = Math.max(0, options.debounceMs ?? 250);
    this.resetFallback();
  }

  configureFallback(seconds: number): void {
    this.fallbackMs = validateFallbackSeconds(seconds) * 1000;
    this.resetFallback();
  }

  notifyEvent(reason: string): void {
    if (this.disposed || !reason) return;
    this.pendingEventReasons.add(reason);
    if (this.paused || this.inFlight) return;
    this.debounceDueAt ??= this.clock.now() + this.debounceMs;
    this.scheduleNext();
  }

  pause(): void {
    if (this.paused || this.disposed) return;
    this.paused = true;
    this.remainingMs = Math.max(0, this.dueAt - this.clock.now());
    this.cancelTimer();
  }

  resume(): void {
    if (!this.paused || this.disposed) return;
    this.paused = false;
    this.dueAt = this.clock.now() + this.remainingMs;
    if (this.pendingEventReasons.size) this.debounceDueAt = this.clock.now() + this.debounceMs;
    this.scheduleNext();
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
    this.pendingEventReasons.clear();
  }

  private resetFallback(): void {
    this.dueAt = this.clock.now() + this.fallbackMs;
    if (!this.paused && !this.disposed) this.scheduleNext();
  }

  private cancelTimer(): void {
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(): void {
    this.cancelTimer();
    if (this.paused || this.disposed || this.inFlight) return;
    const nextAt = this.debounceDueAt === null ? this.dueAt : Math.min(this.dueAt, this.debounceDueAt);
    this.timer = this.clock.setTimeout(() => void this.onTimer(), Math.max(0, nextAt - this.clock.now()));
  }

  private async onTimer(): Promise<void> {
    this.timer = null;
    if (this.paused || this.disposed || this.inFlight) return;
    const now = this.clock.now();
    const eventDue = this.debounceDueAt !== null && this.debounceDueAt <= now;
    const fallbackDue = this.dueAt <= now;
    if (!eventDue && !fallbackDue) {
      this.scheduleNext();
      return;
    }
    const reasons = eventDue ? [...this.pendingEventReasons] : [];
    if (eventDue) {
      this.pendingEventReasons.clear();
      this.debounceDueAt = null;
    }
    this.inFlight = true;
    const dispatch = this.options.dispatch({ kind: eventDue ? 'event' : 'fallback', reasons });
    // Reset at the exact point the owner confirms provider work started, before awaiting its completion.
    if (dispatch.dispatched) this.dueAt = now + this.fallbackMs;
    else if (fallbackDue) this.dueAt = now + this.fallbackMs;
    // A transport backoff postpones an event; it must not consume the wakeup.
    const retryAfterMs = dispatch.retryAfterMs;
    if (
      eventDue &&
      !dispatch.dispatched &&
      retryAfterMs !== undefined &&
      Number.isFinite(retryAfterMs) &&
      retryAfterMs > 0
    ) {
      for (const reason of reasons) this.pendingEventReasons.add(reason);
      this.debounceDueAt = now + retryAfterMs;
    }
    try {
      await dispatch.completion;
    } finally {
      this.inFlight = false;
      if (this.pendingEventReasons.size) this.debounceDueAt ??= this.clock.now() + this.debounceMs;
      this.scheduleNext();
    }
  }
}
