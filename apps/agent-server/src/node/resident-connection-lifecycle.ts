import type { ResidentWorldBinding } from '@seedlands/cognition-protocol';
import type { ExportTransfer, ImportTransfer, Pending, ResidentConnectionLifecycle } from './resident-host-types.js';

type Observer = ((event: ResidentConnectionLifecycle) => void) | undefined;

export function pruneResidentTransfers(
  exports: Map<string, ExportTransfer>,
  imports: Map<string, ImportTransfer>,
): void {
  const now = Date.now();
  for (const [id, transfer] of exports) if (transfer.expiresAt <= now) exports.delete(id);
  for (const [id, transfer] of imports) if (transfer.expiresAt <= now) imports.delete(id);
}

export function rejectResidentPending(pending: Map<string, Pending>, message: string): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(new Error(message));
  }
  pending.clear();
}

export class ResidentConnectionLifecycleOwner {
  private readonly retirements = new Set<Promise<void>>();
  private closed = false;

  constructor(
    private readonly connectionId: string,
    private readonly observer: Observer,
  ) {}

  authenticated(world: ResidentWorldBinding): void {
    this.publish({ phase: 'authenticated', connectionId: this.connectionId, world });
  }

  track(work: Promise<void>): Promise<void> {
    this.retirements.add(work);
    void work.finally(() => this.retirements.delete(work)).catch(() => undefined);
    return work;
  }

  retire(world: ResidentWorldBinding | null, inbound: Promise<void>): void {
    if (this.closed) return;
    this.closed = true;
    this.publish({ phase: 'closed', connectionId: this.connectionId, world });
    void Promise.allSettled([inbound, ...this.retirements]).then((settled) =>
      this.publish({
        phase: settled.some((entry) => entry.status === 'rejected') ? 'retirement-failed' : 'retired',
        connectionId: this.connectionId,
        world,
      }),
    );
  }

  private publish(event: ResidentConnectionLifecycle): void {
    try {
      this.observer?.(event);
    } catch {
      // Diagnostics must never control the connection owner.
    }
  }
}
