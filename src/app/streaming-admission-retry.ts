const INITIAL_STREAMING_RETRY_MS = 100;
const MAX_STREAMING_RETRY_MS = 2_000;
const FAILURE_DECAY_MS = 5_000;

export class StreamingAdmissionRetry {
  private failureCount = 0;
  private scheduledAtMs: number | null = null;
  private lastFailureAtMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly now: () => number = () => performance.now()) {}

  get retryAtMs(): number | null {
    return this.scheduledAtMs;
  }

  recordRetryableFailure(): void {
    const now = this.now();
    if (now - this.lastFailureAtMs > FAILURE_DECAY_MS) this.failureCount = 0;
    this.failureCount += 1;
    this.lastFailureAtMs = now;
    const delayMs = Math.min(MAX_STREAMING_RETRY_MS, INITIAL_STREAMING_RETRY_MS * 2 ** (this.failureCount - 1));
    this.scheduledAtMs = Math.max(this.scheduledAtMs ?? 0, now + delayMs);
  }

  consumeDueRetry(): boolean {
    if (this.scheduledAtMs === null || this.now() < this.scheduledAtMs) return false;
    this.scheduledAtMs = null;
    return true;
  }

  reset(): void {
    this.failureCount = 0;
    this.scheduledAtMs = null;
    this.lastFailureAtMs = Number.NEGATIVE_INFINITY;
  }
}

export async function acceptStreamingCanonical(
  accept: () => boolean | Promise<boolean>,
  retry: StreamingAdmissionRetry,
): Promise<boolean> {
  try {
    const accepted = await accept();
    if (!accepted) retry.recordRetryableFailure();
    return accepted;
  } catch (error) {
    retry.recordRetryableFailure();
    throw error;
  }
}
