import type { PerformanceTelemetry } from '../../client/presentation/performance-telemetry';

type SaveAuthority = Readonly<{ save: () => Promise<unknown> }>;

/** 合并同一帧附近的保存请求，并保持权威快照写入严格串行。 */
export class GameSaveQueue {
  private timer: number | null = null;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly authority: () => SaveAuthority | null,
    private readonly telemetry: PerformanceTelemetry,
  ) {}

  queue(): void {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => undefined);
    }, 48);
  }

  flush(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    const authority = this.authority();
    if (!authority) return this.inFlight;
    const save = this.inFlight.then(async () => {
      const span = this.telemetry.beginSpan('persistence', 'FlushWorldSave');
      try {
        await authority.save();
      } finally {
        this.telemetry.endSpan(span);
      }
    });
    this.inFlight = save.catch(() => undefined);
    return save;
  }
}
