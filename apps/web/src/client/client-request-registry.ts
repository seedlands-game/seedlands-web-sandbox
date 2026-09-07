type Timer = ReturnType<typeof globalThis.setTimeout>;
type Pending = Readonly<{
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: Timer;
}>;

export class ClientRequestRegistry {
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly timeoutMs = 15_000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new RangeError('Authority request timeout must be a positive finite duration.');
  }

  create(requestId: number): Promise<unknown> {
    if (!Number.isSafeInteger(requestId) || requestId < 0 || this.pending.has(requestId))
      throw new RangeError('Authority request id must be unique and non-negative.');
    return new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Authority request ${requestId} timed out after ${this.timeoutMs}ms.`));
      }, this.timeoutMs);
      (timer as unknown as { unref?: () => void }).unref?.();
      this.pending.set(requestId, { resolve, reject, timer });
    });
  }

  has(requestId: number): boolean {
    return this.pending.has(requestId);
  }

  resolve(requestId: number, value: unknown): boolean {
    const pending = this.take(requestId);
    if (!pending) return false;
    pending.resolve(value);
    return true;
  }

  reject(requestId: number, error: Error): boolean {
    const pending = this.take(requestId);
    if (!pending) return false;
    pending.reject(error);
    return true;
  }

  rejectAll(error: Error): void {
    for (const requestId of this.pending.keys()) this.reject(requestId, error);
  }

  private take(requestId: number): Pending | null {
    const pending = this.pending.get(requestId);
    if (!pending) return null;
    globalThis.clearTimeout(pending.timer);
    this.pending.delete(requestId);
    return pending;
  }
}
