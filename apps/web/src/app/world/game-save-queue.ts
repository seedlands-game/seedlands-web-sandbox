import type { BrowserAuthorityClient } from '../../client/authority/browser-authority-client';
import type { RemoteAuthorityClient } from '../../client/authority/remote-authority-client';
import type { PerformanceTelemetry } from '../../client/presentation/performance-telemetry';

type SaveAuthority = BrowserAuthorityClient | RemoteAuthorityClient;

export class GameSaveQueue {
  private timer: number | null = null;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly authority: () => SaveAuthority | null,
    private readonly telemetry: () => PerformanceTelemetry,
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
      const telemetry = this.telemetry();
      const span = telemetry.beginSpan('persistence', 'FlushWorldSave');
      try {
        await authority.save();
      } finally {
        telemetry.endSpan(span);
      }
    });
    this.inFlight = save.catch(() => undefined);
    return save;
  }
}
