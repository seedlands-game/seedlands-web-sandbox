import type { CDPSession } from '@playwright/test';

export async function withCdpTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out.`)), 10_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

type Pending = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Public nested CDP protocol, without accessing Playwright's private transport. */
export class WorkerTargetSession {
  private readonly pending = new Map<number, Pending>();
  private sequence = 0;
  private closed = false;
  private stopping?: Promise<void>;
  constructor(
    private readonly browser: CDPSession,
    private readonly sessionId: string,
  ) {
    browser.on('Target.receivedMessageFromTarget', this.receive);
    browser.on('Target.detachedFromTarget', this.detached);
  }
  private settle(id: number, error?: unknown, result?: unknown): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (error !== undefined) pending.reject(error);
    else pending.resolve(result);
  }
  private rejectAll(error: unknown): void {
    for (const id of this.pending.keys()) this.settle(id, error);
  }
  private readonly receive = (event: { sessionId: string; message: string }): void => {
    if (event.sessionId !== this.sessionId) return;
    try {
      const message: { id?: number; result?: unknown; error?: { code?: number; message?: string } } = JSON.parse(
        event.message,
      );
      if (!Number.isSafeInteger(message.id) || !this.pending.has(message.id!)) return;
      const error = message.error
        ? new Error(
            `Worker ${this.pending.get(message.id!)!.method} failed (${message.error.code}): ${message.error.message}`,
          )
        : undefined;
      this.settle(message.id!, error, message.result);
    } catch (cause) {
      this.rejectAll(new Error('Invalid nested worker CDP response.', { cause }));
    }
  };
  private readonly detached = (event: { sessionId: string }): void => {
    if (event.sessionId !== this.sessionId) return;
    this.closed = true;
    this.rejectAll(new Error('Authority worker target detached before diagnostic completion.'));
  };
  send(method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Authority worker target session is closed.'));
    if (this.pending.size >= 64) return Promise.reject(new Error('Worker CDP pending request limit exceeded.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.settle(id, new Error(`Worker ${method} response timed out.`)), 10_000);
      this.pending.set(id, { method, resolve, reject, timer });
      void this.browser
        .send('Target.sendMessageToTarget', {
          sessionId: this.sessionId,
          message: JSON.stringify({ id, method, ...(params ? { params } : {}) }),
        })
        .catch((error: unknown) => this.settle(id, error));
    });
  }
  detach(): Promise<void> {
    this.stopping ??= (async () => {
      const wasClosed = this.closed;
      this.closed = true;
      this.rejectAll(new Error('Worker CDP session closed during cleanup.'));
      this.browser.off('Target.receivedMessageFromTarget', this.receive);
      this.browser.off('Target.detachedFromTarget', this.detached);
      if (!wasClosed)
        await withCdpTimeout(
          this.browser.send('Target.detachFromTarget', { sessionId: this.sessionId }),
          'Worker target detach',
        );
    })();
    return this.stopping;
  }
}
