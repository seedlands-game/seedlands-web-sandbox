import type { LogicIntentBatch, LogicObservation } from '@seedlands/game-core/server/logic/logic-protocol';
import type { AuthorityRuntime } from '@seedlands/game-core/server/authority/authority-runtime';
import type { AuthorityWorldHarness } from '@seedlands/game-core/server/harness/authority-world-harness';
import type { BrowserAuthorityIngress } from './authority-worker-ingress';
import type { BrowserAuthorityDeterministicAdvance } from './authority-worker-deterministic-advance';
import { AuthorityWorkerDirectLogic } from './authority-worker-direct-logic';
import {
  DIRECT_LOGIC_PROTOCOL_VERSION,
  type DirectLogicAttachRequest,
  type DirectLogicDiagnostics,
} from './authority-worker-direct-logic-protocol';

type State = Readonly<{
  runtime: AuthorityRuntime | null;
  harness: AuthorityWorldHarness | null;
  ingress: BrowserAuthorityIngress | null;
  advance: BrowserAuthorityDeterministicAdvance | null;
}>;

type Options = Readonly<{
  state: () => State;
  now: () => number;
  diagnostics: (value: DirectLogicDiagnostics) => void;
  fatal: (error: Error) => void;
}>;

type QueuedAcceptance = Readonly<{
  advance: BrowserAuthorityDeterministicAdvance;
  epoch: string;
  run: () => boolean;
  cancel: () => void;
}>;

export class AuthorityWorkerDirectLogicOwner {
  private link: AuthorityWorkerDirectLogic | null = null;
  private queuedAcceptance: QueuedAcceptance | null = null;

  constructor(private readonly options: Options) {}

  get attached(): boolean {
    return this.link !== null;
  }

  attach(message: DirectLogicAttachRequest): void {
    if (message.protocolVersion !== DIRECT_LOGIC_PROTOCOL_VERSION) return;
    if (this.link) throw new Error('Direct Logic port is already attached.');
    if (!message.epoch.trim()) throw new TypeError('Direct Logic attach epoch must not be empty.');
    this.link = new AuthorityWorkerDirectLogic(message.port, message.epoch, {
      acceptBatch: (batch) => this.accept(batch),
      now: this.options.now,
      diagnostics: this.options.diagnostics,
      fatal: this.options.fatal,
    });
  }

  publish(observation: LogicObservation, fallback: () => void): void {
    if (!this.link) {
      fallback();
      return;
    }
    const queued = this.queuedAcceptance;
    const { advance } = this.options.state();
    if (queued && queued.advance === advance && advance.isAdvancing && observation.epoch === queued.epoch) queued.run();
    this.link.publish(observation);
  }

  rebindEpoch(nextEpoch: string): void {
    this.cancelQueuedAcceptance();
    this.link?.rebindEpoch(nextEpoch);
  }

  close(): void {
    this.cancelQueuedAcceptance();
    this.link?.close();
    this.link = null;
  }

  private async accept(batch: LogicIntentBatch): Promise<boolean> {
    const { runtime, harness, ingress, advance } = this.options.state();
    if (!runtime || !harness || !ingress || !advance) return false;
    const accept = () => {
      const current = this.options.state();
      if (
        current.runtime !== runtime ||
        current.harness !== harness ||
        current.ingress !== ingress ||
        current.advance !== advance
      )
        return false;
      ingress.logic();
      if (!harness.acceptsAutomaticLogic()) return false;
      const accepted = advance.acceptLogicIntentBatch(batch);
      harness.notifyProgress();
      if (!advance.isAdvancing) runtime.requestLogicObservation();
      return accepted;
    };
    return advance.isAdvancing ? accept() : this.queueAcceptance(harness, advance, batch.epoch, accept);
  }

  private queueAcceptance(
    harness: AuthorityWorldHarness,
    advance: BrowserAuthorityDeterministicAdvance,
    epoch: string,
    accept: () => boolean,
  ): Promise<boolean> {
    if (this.queuedAcceptance) return Promise.resolve(false);
    let resolveCompletion!: (accepted: boolean) => void;
    let rejectCompletion!: (error: unknown) => void;
    const completion = new Promise<boolean>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    let settled = false;
    let accepted = false;
    const clear = () => {
      if (this.queuedAcceptance === queued) this.queuedAcceptance = null;
    };
    const run = () => {
      if (settled) return accepted;
      settled = true;
      clear();
      try {
        accepted = accept();
        resolveCompletion(accepted);
        return accepted;
      } catch (error) {
        rejectCompletion(error);
        throw error;
      }
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      clear();
      resolveCompletion(false);
    };
    const queued: QueuedAcceptance = { advance, epoch, run, cancel };
    this.queuedAcceptance = queued;
    void harness.hostOperation(run).catch((error: unknown) => {
      if (settled) return;
      settled = true;
      clear();
      rejectCompletion(error);
    });
    return completion;
  }

  private cancelQueuedAcceptance(): void {
    this.queuedAcceptance?.cancel();
  }
}
