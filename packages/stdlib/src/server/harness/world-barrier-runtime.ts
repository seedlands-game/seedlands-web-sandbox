import type { CoreTimerPort } from '../../runtime/platform-ports';
import type { WorldBarrierRequest, WorldFrontier, WorldHarnessError } from './world-harness-contract';
import { validateWorldFrontier } from './world-harness-validation';

type Options = Readonly<{
  timers: CoreTimerPort;
  frontier: () => WorldFrontier;
  checkpointCommitSequence: () => number;
  settled: (frontier: WorldFrontier) => boolean;
}>;

export class WorldBarrierFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly kind: WorldHarnessError['kind'],
  ) {
    super(message);
  }
}

/** 只等待请求 frontier 之前已经派发的有限工作集；后续工作不会饿死旧屏障。 */
export class WorldBarrierRuntime {
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: Options) {}

  async wait(request: WorldBarrierRequest): Promise<void> {
    if (!Number.isFinite(request.timeoutMs) || request.timeoutMs < 0 || request.timeoutMs > 60_000)
      throw new RangeError('Barrier timeout must be within 0..60000 ms.');
    validateWorldFrontier(request.frontier);
    const current = this.options.frontier();
    if (request.frontier.worldId !== current.worldId || request.frontier.epoch !== current.epoch)
      throw new WorldBarrierFailure(
        'WORLD_BARRIER_STALE_EPOCH',
        'Barrier frontier belongs to a stale world epoch.',
        'conflict',
      );
    if (!this.reached(request)) await this.waitForProgress(request);
  }

  notify(): void {
    [...this.listeners].forEach((listener) => listener());
  }

  private reached(request: WorldBarrierRequest): boolean {
    const current = this.options.frontier();
    if (request.frontier.worldId !== current.worldId || request.frontier.epoch !== current.epoch)
      throw new WorldBarrierFailure(
        'WORLD_BARRIER_STALE_EPOCH',
        'Barrier frontier belongs to a stale world epoch.',
        'conflict',
      );
    if (
      current.worldRevision < request.frontier.worldRevision ||
      current.commitSequence < request.frontier.commitSequence ||
      current.physicsTick < request.frontier.physicsTick
    )
      return false;
    if (request.kind === 'checkpoint')
      return this.options.checkpointCommitSequence() >= request.frontier.commitSequence;
    return request.kind !== 'settled' || this.options.settled(request.frontier);
  }

  private waitForProgress(request: WorldBarrierRequest): Promise<void> {
    return new Promise((resolve, reject) => {
      let completed = false;
      const finish = (failure?: Error) => {
        if (completed) return;
        completed = true;
        this.listeners.delete(check);
        this.options.timers.clear(timeout);
        if (failure) reject(failure);
        else resolve();
      };
      const check = () => {
        try {
          if (this.reached(request)) finish();
        } catch (cause) {
          finish(cause instanceof Error ? cause : new Error(String(cause)));
        }
      };
      const timeout = this.options.timers.set(
        () => finish(new WorldBarrierFailure('WORLD_BARRIER_TIMEOUT', 'World barrier timed out.', 'unavailable')),
        request.timeoutMs,
      );
      this.listeners.add(check);
      check();
    });
  }
}
