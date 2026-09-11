import type { LogicIntentBatch, LogicObservation } from '@seedlands/game-core/server/logic/logic-protocol';
import {
  DIRECT_LOGIC_PROTOCOL_VERSION,
  type DirectLogicDiagnostics,
  type DirectLogicMessage,
} from './authority-worker-direct-logic-protocol';

type Port = Pick<MessagePort, 'onmessage' | 'onmessageerror' | 'postMessage' | 'start' | 'close'>;

type Options = Readonly<{
  acceptBatch: (batch: LogicIntentBatch) => Promise<boolean> | boolean;
  now: () => number;
  diagnostics: (value: DirectLogicDiagnostics) => void;
  fatal: (error: Error) => void;
  diagnosticIntervalMs?: number;
}>;

/** One-in-flight/latest-pending transport; Authority remains the only state writer. */
export class AuthorityWorkerDirectLogic {
  private inFlight: Readonly<{ epoch: string; sequence: number; startedAt: number }> | null = null;
  private pending: LogicObservation | null = null;
  private submitted = 0;
  private received = 0;
  private completed = 0;
  private rejected = 0;
  private lastRoundTripMs: number | null = null;
  private lastDiagnosticAt = Number.NEGATIVE_INFINITY;
  private accepting: Readonly<{ epoch: string; sequence: number; startedAt: number }> | null = null;
  private closed = false;

  constructor(
    private readonly port: Port,
    private epoch: string,
    private readonly options: Options,
  ) {
    port.onmessage = (event) => void this.receive(event.data as DirectLogicMessage);
    port.onmessageerror = () => this.fail(new Error('Direct Logic port could not decode a message.'));
    try {
      port.start();
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  publish(observation: LogicObservation): void {
    if (this.closed || observation.epoch !== this.epoch) return;
    if (this.inFlight) {
      this.pending = observation;
      this.report();
      return;
    }
    try {
      this.postObservation(observation);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  rebindEpoch(nextEpoch: string): void {
    if (this.closed || nextEpoch === this.epoch) return;
    if (!nextEpoch.trim()) throw new TypeError('Direct Logic epoch must not be empty.');
    const previous = this.epoch;
    this.epoch = nextEpoch;
    this.inFlight = null;
    this.accepting = null;
    this.pending = null;
    try {
      this.port.postMessage({
        kind: 'direct-logic-reset',
        protocolVersion: DIRECT_LOGIC_PROTOCOL_VERSION,
        epoch: previous,
        nextEpoch,
      } satisfies DirectLogicMessage);
      this.report(true);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.inFlight = null;
    this.accepting = null;
    this.pending = null;
    this.port.onmessage = null;
    this.port.onmessageerror = null;
    try {
      this.port.close();
    } catch {
      // Local state is already closed; a failed platform close cannot revive the link.
    }
  }

  private postObservation(observation: LogicObservation): void {
    const transfer = observation.decisionContext.terrainWindows.map((window) => window.occupancy.buffer);
    this.port.postMessage(
      {
        kind: 'direct-logic-observation',
        protocolVersion: DIRECT_LOGIC_PROTOCOL_VERSION,
        observation,
      } satisfies DirectLogicMessage,
      transfer,
    );
    this.inFlight = {
      epoch: observation.epoch,
      sequence: observation.observationSequence,
      startedAt: this.options.now(),
    };
    this.submitted += 1;
    this.report();
  }

  private async receive(message: DirectLogicMessage): Promise<void> {
    if (this.closed || !message || message.protocolVersion !== DIRECT_LOGIC_PROTOCOL_VERSION) return;
    if (message.kind !== 'direct-logic-intents')
      return this.fail(new Error('Direct Logic message direction is invalid.'));
    try {
      const current = this.inFlight;
      this.received += 1;
      if (
        !current ||
        this.accepting !== null ||
        current.epoch !== message.batch.epoch ||
        current.sequence !== message.batch.observationSequence
      ) {
        this.rejected += 1;
        this.report();
        return;
      }
      this.accepting = current;
      const accepted = await this.options.acceptBatch(message.batch);
      if (this.closed || this.accepting !== current || this.inFlight !== current) return;
      this.accepting = null;
      this.inFlight = null;
      this.completed += 1;
      if (accepted) this.lastRoundTripMs = Math.max(0, this.options.now() - current.startedAt);
      else this.rejected += 1;
      const pending = this.pending;
      this.pending = null;
      if (pending) {
        try {
          this.postObservation(pending);
        } catch (error) {
          return this.fail(error instanceof Error ? error : new Error(String(error)));
        }
      } else this.report();
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private report(force = false): void {
    const now = this.options.now();
    if (!force && now - this.lastDiagnosticAt < (this.options.diagnosticIntervalMs ?? 250)) return;
    this.lastDiagnosticAt = now;
    this.options.diagnostics({
      kind: 'direct-logic-diagnostics',
      protocolVersion: DIRECT_LOGIC_PROTOCOL_VERSION,
      epoch: this.epoch,
      observationInFlight: this.inFlight !== null,
      pendingObservationCount: this.pending ? 1 : 0,
      submittedObservationCount: this.submitted,
      receivedBatchCount: this.received,
      completedBatchCount: this.completed,
      rejectedBatchCount: this.rejected,
      lastRoundTripMs: this.lastRoundTripMs,
    });
  }

  private fail(error: Error): void {
    this.close();
    this.options.fatal(error);
  }
}
