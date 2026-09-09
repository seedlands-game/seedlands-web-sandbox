import {
  LOGIC_PROTOCOL_VERSION,
  type LogicIntentBatch,
  type LogicObservation,
  type LogicWorkerRequest,
  type LogicWorkerResponse,
} from '@seedlands/game-core/server/logic/logic-protocol';

export type LogicWorkerPort = {
  onmessage: ((event: MessageEvent<LogicWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: LogicWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
};

type Options = Readonly<{
  onIntents?: (batch: LogicIntentBatch) => void;
  onFatal?: (error: Error) => void;
}>;

export class BrowserLogicClient {
  private ready = false;
  private disposed = false;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private blockSequence = 0;
  private readonly blocks = new Map<
    number,
    { resolveStarted: () => void; rejectStarted: (error: Error) => void; started: boolean }
  >();
  private blockStartedCount = 0;
  private blockCompletedCount = 0;
  private observationInFlight = false;
  private pendingObservation: LogicObservation | null = null;
  private submittedObservationCount = 0;
  private completedBatchCount = 0;
  private observationStartedAt: number | null = null;
  private lastRoundTripMs: number | null = null;
  private epochValue: string;

  constructor(
    private readonly worker: LogicWorkerPort,
    epoch: string,
    private readonly options: Options = {},
  ) {
    this.epochValue = epoch;
    worker.onmessage = (event) => this.receive(event.data);
    worker.onerror = (event) => this.fail(new Error(event.message || 'Game Logic Worker failed.'));
  }

  get epoch(): string {
    return this.epochValue;
  }

  rebindEpoch(nextEpoch: string): void {
    if (!this.ready || this.disposed) throw new Error('Logic client is unavailable.');
    if (!nextEpoch.trim()) throw new TypeError('Next Logic epoch must not be empty.');
    if (nextEpoch === this.epochValue) return;
    const previousEpoch = this.epochValue;
    this.epochValue = nextEpoch;
    this.observationInFlight = false;
    this.pendingObservation = null;
    this.observationStartedAt = null;
    this.worker.postMessage({
      kind: 'reset-logic-epoch',
      protocolVersion: LOGIC_PROTOCOL_VERSION,
      epoch: previousEpoch,
      nextEpoch,
    });
  }

  static create(epoch: string, options: Options = {}) {
    return new BrowserLogicClient(
      new Worker(new URL('../../worker/game-logic-worker.ts', import.meta.url), { type: 'module' }),
      epoch,
      options,
    );
  }

  start(harnessEnabled: boolean, physicsHz: 30 | 60 | 120): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Logic client is disposed.'));
    if (this.resolveReady || this.ready) return Promise.reject(new Error('Logic client already started.'));
    const ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.worker.postMessage({
      kind: 'init-logic',
      protocolVersion: LOGIC_PROTOCOL_VERSION,
      epoch: this.epoch,
      harnessEnabled,
      physicsHz,
    });
    return ready;
  }

  sendObservation(observation: LogicObservation): void {
    if (!this.ready || this.disposed || observation.epoch !== this.epoch) return;
    if (this.observationInFlight) {
      this.pendingObservation = observation;
      return;
    }
    this.postObservation(observation);
  }

  private postObservation(observation: LogicObservation): void {
    const occupancy = observation.decisionContext.terrainWindows.map((window) => window.occupancy.buffer);
    try {
      this.worker.postMessage(
        { kind: 'logic-observation', protocolVersion: LOGIC_PROTOCOL_VERSION, observation },
        occupancy,
      );
      this.observationInFlight = true;
      this.submittedObservationCount += 1;
      this.observationStartedAt = performance.now();
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  get diagnostics() {
    return {
      blockStartedCount: this.blockStartedCount,
      blockCompletedCount: this.blockCompletedCount,
      observationInFlight: this.observationInFlight,
      pendingObservationCount: this.pendingObservation ? 1 : 0,
      submittedObservationCount: this.submittedObservationCount,
      completedBatchCount: this.completedBatchCount,
      lastRoundTripMs: this.lastRoundTripMs,
    } as const;
  }

  get isReady(): boolean {
    return this.ready && !this.disposed;
  }

  blockForHarness(ms: number): Promise<void> {
    if (!this.ready || this.disposed) throw new Error('Logic client is unavailable.');
    const requestId = ++this.blockSequence;
    const started = new Promise<void>((resolveStarted, rejectStarted) =>
      this.blocks.set(requestId, { resolveStarted, rejectStarted, started: false }),
    );
    try {
      this.worker.postMessage({
        kind: 'block-for-test',
        protocolVersion: LOGIC_PROTOCOL_VERSION,
        epoch: this.epoch,
        requestId,
        ms,
      });
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.blocks.get(requestId)?.rejectStarted(failure);
      this.blocks.delete(requestId);
      this.fail(failure);
    }
    return started;
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.ready)
      try {
        this.worker.postMessage({ kind: 'dispose-logic', protocolVersion: LOGIC_PROTOCOL_VERSION, epoch: this.epoch });
      } catch {
        // The worker may already be gone; local disposal still completes.
      }
    this.disposed = true;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.blocks.forEach(({ rejectStarted, started }) => {
      if (!started) rejectStarted(new Error('Logic client was disposed.'));
    });
    this.blocks.clear();
    this.rejectReady?.(new Error('Logic client was disposed.'));
    this.resolveReady = null;
    this.rejectReady = null;
  }

  private receive(message: LogicWorkerResponse): void {
    if (this.disposed || message.protocolVersion !== LOGIC_PROTOCOL_VERSION) return;
    const messageEpoch = message.kind === 'logic-intents' ? message.batch.epoch : message.epoch;
    if (messageEpoch !== this.epoch) return;
    if (message.kind === 'logic-ready') {
      this.ready = true;
      this.resolveReady?.();
      this.resolveReady = null;
      this.rejectReady = null;
      return;
    }
    if (message.kind === 'logic-intents') {
      this.observationInFlight = false;
      this.completedBatchCount += 1;
      this.lastRoundTripMs =
        this.observationStartedAt === null ? null : Math.max(0, performance.now() - this.observationStartedAt);
      this.observationStartedAt = null;
      this.options.onIntents?.(message.batch);
      const pending = this.pendingObservation;
      this.pendingObservation = null;
      if (pending) this.postObservation(pending);
    } else if (message.kind === 'logic-block-started') {
      this.blockStartedCount += 1;
      const block = this.blocks.get(message.requestId);
      if (block && !block.started) {
        block.started = true;
        block.resolveStarted();
      }
    } else if (message.kind === 'logic-block-finished') {
      this.blockCompletedCount += 1;
      this.blocks.delete(message.requestId);
    } else if (message.kind === 'logic-fatal') this.fail(new Error(message.error));
  }

  private fail(error: Error): void {
    this.ready = false;
    this.observationInFlight = false;
    this.pendingObservation = null;
    this.observationStartedAt = null;
    this.rejectReady?.(error);
    this.resolveReady = null;
    this.rejectReady = null;
    this.blocks.forEach(({ rejectStarted, started }) => {
      if (!started) rejectStarted(error);
    });
    this.blocks.clear();
    this.options.onFatal?.(error);
  }
}
