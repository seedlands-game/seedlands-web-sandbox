export class ClientReadyWait<Value> {
  private resolveValue: ((value: Value) => void) | null = null;
  private rejectValue: ((error: Error) => void) | null = null;
  private timer: ReturnType<typeof globalThis.setTimeout> | null = null;

  constructor(private readonly timeoutMs = 15_000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new RangeError('Authority ready timeout must be a positive finite duration.');
  }

  get pending(): boolean {
    return this.resolveValue !== null;
  }

  start(): Promise<Value> {
    if (this.pending) return Promise.reject(new Error('Authority ready wait is already pending.'));
    const promise = new Promise<Value>((resolve, reject) => {
      this.resolveValue = resolve;
      this.rejectValue = reject;
    });
    this.timer = globalThis.setTimeout(() => this.reject(new Error('Authority start timed out.')), this.timeoutMs);
    (this.timer as unknown as { unref?: () => void }).unref?.();
    return promise;
  }

  resolve(value: Value): boolean {
    if (!this.resolveValue) return false;
    this.resolveValue(value);
    this.clear();
    return true;
  }

  reject(error: Error): boolean {
    if (!this.rejectValue) return false;
    this.rejectValue(error);
    this.clear();
    return true;
  }

  private clear(): void {
    if (this.timer !== null) globalThis.clearTimeout(this.timer);
    this.timer = null;
    this.resolveValue = null;
    this.rejectValue = null;
  }
}
