import type { CorePlatformPorts } from '../../runtime/platform-ports';

type EnqueueAdvance = (elapsedMs: number, isCurrent: () => boolean) => Promise<unknown>;

/** Owns the wall-clock timer lifecycle without owning Authority state. */
export class HeadlessClockScheduler {
  private timer: unknown = null;
  private wallTimeMs = 0;
  private enabled = false;
  private generation = 0;
  private failureValue: Error | null = null;
  private disposed = false;

  constructor(
    private readonly platform: CorePlatformPorts,
    private readonly enqueueAdvance: EnqueueAdvance,
  ) {}

  get failure(): Error | null {
    return this.failureValue;
  }

  start(): void {
    if (this.disposed) throw new Error('Headless session is disposed.');
    if (this.enabled) return;
    this.enabled = true;
    this.generation += 1;
    this.failureValue = null;
    this.wallTimeMs = this.platform.now();
    this.schedule();
  }

  stop(): void {
    this.enabled = false;
    this.generation += 1;
    if (this.timer !== null) this.platform.timers.clear(this.timer);
    this.timer = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
  }

  private schedule(): void {
    if (this.disposed || !this.enabled || this.timer !== null) return;
    const generation = this.generation;
    const isCurrent = () => !this.disposed && this.enabled && generation === this.generation;
    this.timer = this.platform.timers.set(() => {
      this.timer = null;
      if (!isCurrent()) return;
      const now = this.platform.now();
      const elapsedMs = Math.max(0, now - this.wallTimeMs);
      this.wallTimeMs = now;
      void this.enqueueAdvance(elapsedMs, isCurrent)
        .catch((cause) => {
          this.failureValue = cause instanceof Error ? cause : new Error(String(cause));
          if (isCurrent()) this.stop();
        })
        .finally(() => {
          if (isCurrent()) this.schedule();
        });
    }, 8);
  }
}
