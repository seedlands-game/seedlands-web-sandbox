import {
  copyAuthorityBaselineCapture,
  parseAuthorityChunkKey,
  assertAuthorityBaselineCaptureRequest,
  authorityBaselineCaptureKeys,
} from '../authority/authority-baseline-capture';
import {
  AUTHORITY_BASELINE_CAPTURE_COMPLETION_WINDOW,
  type AuthorityBaselineCaptureCancellation,
  type AuthorityBaselineCaptureRequest,
  type AuthorityBaselineCaptureResult,
} from '../authority/authority-baseline-capture-types';
import type { CanonicalAdmissionLease } from './dedicated-canonical-admission';
import type { AuthorityRuntime } from '../authority/authority-runtime';
import type { CoreAbortSignal } from '../../runtime/platform-ports';

type ActiveCapture = {
  generation: number;
  cancelled: boolean;
  completion: Promise<AuthorityBaselineCaptureResult>;
};

export type DedicatedBaselineCapturePort = Readonly<{
  isRunning(): boolean;
  hasLoaded(key: string): boolean;
  reserve(keys: readonly string[]): CanonicalAdmissionLease | null;
  retain(request: AuthorityBaselineCaptureRequest): () => void;
  requestChunk(key: string, lease: CanonicalAdmissionLease): Promise<boolean>;
  copy(request: AuthorityBaselineCaptureRequest, generation: number): AuthorityBaselineCaptureResult;
}>;

export function createDedicatedBaselineCaptureCoordinator(options: {
  runtime: AuthorityRuntime;
  isRunning(): boolean;
  reserve(keys: readonly string[]): CanonicalAdmissionLease | null;
  requestChunk(key: string, lease: CanonicalAdmissionLease): Promise<boolean>;
}): DedicatedBaselineCaptureCoordinator {
  const { runtime } = options;
  return new DedicatedBaselineCaptureCoordinator({
    isRunning: options.isRunning,
    hasLoaded: (key) => runtime.server.hasLoadedCanonicalChunk(key),
    reserve: options.reserve,
    retain: (request) => {
      if (request.purpose === 'collision-resync') return runtime.server.retainCollisionBaseline(request.key);
      const [cx, cy, cz] = parseAuthorityChunkKey(request.key);
      return runtime.server.retainMeshPreparationNeighborhood(cx, cy, cz);
    },
    requestChunk: options.requestChunk,
    copy: (request, generation) =>
      copyAuthorityBaselineCapture(request, generation, {
        generatorVersion: runtime.server.generatorVersion,
        checkpoint: () => {
          const snapshot = runtime.snapshot();
          return {
            epoch: snapshot.epoch,
            physicsTick: snapshot.physicsTick,
            commitSequence: snapshot.commitSequence,
            worldRevision: snapshot.worldRevision,
          };
        },
        readCollisionBaseline: (key, minimumRevision) => runtime.readCollisionBaseline(key, minimumRevision),
      }),
  });
}

export class DedicatedBaselineCaptureCoordinator {
  private captureIdHighWatermark = -1;
  private nextGeneration = 0;
  private closing = false;
  private readonly active = new Map<number, ActiveCapture>();
  private readonly completed = new Map<number, number>();
  private readonly idleWaiters = new Set<() => void>();

  constructor(private readonly port: DedicatedBaselineCapturePort) {}

  capture(request: AuthorityBaselineCaptureRequest, signal?: CoreAbortSignal): Promise<AuthorityBaselineCaptureResult> {
    const accepted = assertAuthorityBaselineCaptureRequest(request);
    if (accepted.captureId <= this.captureIdHighWatermark)
      return Promise.reject(new RangeError('Authority baseline captureId must be strictly increasing.'));
    this.captureIdHighWatermark = accepted.captureId;
    const generation = this.nextGeneration++;
    if (this.closing || !this.port.isRunning()) {
      const result = this.unavailable(accepted, generation, 'stopping');
      this.remember(accepted.captureId, generation);
      return Promise.resolve(result);
    }
    const active: ActiveCapture = { generation, cancelled: signal?.aborted ?? false, completion: null as never };
    const abort = () => {
      active.cancelled = true;
    };
    signal?.addEventListener('abort', abort, { once: true });
    active.completion = this.run(accepted, active).finally(() => {
      signal?.removeEventListener('abort', abort);
      this.active.delete(accepted.captureId);
      this.remember(accepted.captureId, generation);
      this.notifyIdle();
    });
    this.active.set(accepted.captureId, active);
    return active.completion;
  }

  async cancel(captureId: number): Promise<AuthorityBaselineCaptureCancellation> {
    if (!Number.isSafeInteger(captureId) || captureId < 0)
      throw new RangeError('Authority baseline cancellation captureId is invalid.');
    const active = this.active.get(captureId);
    if (active) {
      active.cancelled = true;
      await active.completion.catch(() => undefined);
      return { captureId, captureGeneration: active.generation, status: 'cancelled' };
    }
    const generation = this.completed.get(captureId);
    return generation === undefined
      ? { captureId, captureGeneration: null, status: 'unknown' }
      : { captureId, captureGeneration: generation, status: 'already-settled' };
  }

  beginClose(): void {
    if (this.closing) return;
    this.closing = true;
    for (const capture of this.active.values()) capture.cancelled = true;
  }

  whenIdle(): Promise<void> {
    if (!this.active.size) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  diagnostics() {
    return {
      pendingBaselineCaptures: this.active.size,
      baselineCaptureOwners: this.active.size,
      captureIdHighWatermark: this.captureIdHighWatermark,
    };
  }

  private async run(
    request: AuthorityBaselineCaptureRequest,
    active: ActiveCapture,
  ): Promise<AuthorityBaselineCaptureResult> {
    const keys = authorityBaselineCaptureKeys(request);
    const releaseRetention = this.port.retain(request);
    try {
      if (active.cancelled) return this.unavailable(request, active.generation, 'cancelled');
      const lease = this.port.reserve(keys);
      if (!lease) return this.unavailable(request, active.generation, 'residency-pressure');
      try {
        const prepared: Promise<boolean>[] = [];
        let startError: unknown;
        for (const key of keys)
          try {
            prepared.push(this.port.hasLoaded(key) ? Promise.resolve(true) : this.port.requestChunk(key, lease));
          } catch (error) {
            startError = error;
            break;
          }
        lease.releaseUnused();
        const settled = await Promise.allSettled(prepared);
        if (startError) throw startError;
        const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (rejected) throw rejected.reason;
        const available = settled.map((result) => (result as PromiseFulfilledResult<boolean>).value);
        if (active.cancelled || this.closing) return this.unavailable(request, active.generation, 'cancelled');
        if (available.some((value) => !value)) return this.unavailable(request, active.generation, 'not-available');
        return this.port.copy(request, active.generation);
      } finally {
        lease.releaseUnused();
      }
    } finally {
      releaseRetention();
    }
  }

  private unavailable(
    request: AuthorityBaselineCaptureRequest,
    generation: number,
    reason: Extract<AuthorityBaselineCaptureResult, { status: 'unavailable' }>['reason'],
  ): AuthorityBaselineCaptureResult {
    return {
      status: 'unavailable',
      captureId: request.captureId,
      captureGeneration: generation,
      purpose: request.purpose,
      key: request.key,
      reason,
    };
  }

  private remember(captureId: number, generation: number): void {
    this.completed.set(captureId, generation);
    while (this.completed.size > AUTHORITY_BASELINE_CAPTURE_COMPLETION_WINDOW)
      this.completed.delete(this.completed.keys().next().value!);
  }

  private notifyIdle(): void {
    if (this.active.size) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}
