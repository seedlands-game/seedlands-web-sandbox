import type { SequenceDecision } from '@seedlands/game-core/runtime/session-protocol';
import type { projectRemoteInput } from './remote-authority-input-pipeline';

const MAX_SAMPLES = 16;

export type RemoteInputDiagnosticSample = Readonly<{
  ordinal: number;
  inputSequence: number;
  targetPhysicsTick: number;
  snapshotPhysicsTick: number;
  snapshotElapsedMs: number;
  decisionLatencyMs: number | null;
  decision: SequenceDecision | null;
  moveX: number;
  moveZ: number;
}>;

export type RemoteInputDiagnosticSummary = Readonly<{
  sent: number;
  matchedDecisions: number;
  ignoredDecisions: number;
  accepted: number;
  late: number;
  resync: number;
  samples: readonly RemoteInputDiagnosticSample[];
}>;

type MutableSample = Omit<RemoteInputDiagnosticSample, 'decisionLatencyMs' | 'decision'> & {
  sentAtMs: number;
  decisionLatencyMs: number | null;
  decision: SequenceDecision | null;
};

export class RemoteAuthorityInputDiagnostics {
  private sentCount = 0;
  private matchedDecisionCount = 0;
  private ignoredDecisionCount = 0;
  private acceptedCount = 0;
  private lateCount = 0;
  private resyncCount = 0;
  private readonly samples: MutableSample[] = [];

  sent(
    projected: ReturnType<typeof projectRemoteInput>,
    snapshotPhysicsTick: number,
    snapshotReceivedAtMs: number,
    sentAtMs: number,
  ): void {
    this.sentCount += 1;
    const { state, edge } = projected;
    const nonNeutral =
      state.moveX !== 0 || state.moveZ !== 0 || state.verticalIntent !== 0 || state.jumpHeld || edge !== null;
    if (!nonNeutral || this.samples.length >= MAX_SAMPLES) return;
    this.samples.push({
      ordinal: this.samples.length + 1,
      inputSequence: state.inputSequence,
      targetPhysicsTick: state.targetPhysicsTick,
      snapshotPhysicsTick,
      snapshotElapsedMs: Math.max(0, sentAtMs - snapshotReceivedAtMs),
      decisionLatencyMs: null,
      decision: null,
      moveX: state.moveX,
      moveZ: state.moveZ,
      sentAtMs,
    });
  }

  ignoredDecision(): void {
    this.ignoredDecisionCount += 1;
  }

  matchedDecision(inputSequence: number, decision: SequenceDecision, requiresResync: boolean, now: number): void {
    this.matchedDecisionCount += 1;
    if (decision === 'accepted') this.acceptedCount += 1;
    if (decision === 'late') this.lateCount += 1;
    if (requiresResync) this.resyncCount += 1;
    const sample = this.samples.find((candidate) => candidate.inputSequence === inputSequence);
    if (!sample || sample.decision !== null) return;
    sample.decision = decision;
    sample.decisionLatencyMs = Math.max(0, now - sample.sentAtMs);
  }

  snapshot(): RemoteInputDiagnosticSummary {
    return Object.freeze({
      sent: this.sentCount,
      matchedDecisions: this.matchedDecisionCount,
      ignoredDecisions: this.ignoredDecisionCount,
      accepted: this.acceptedCount,
      late: this.lateCount,
      resync: this.resyncCount,
      samples: this.samples.map(({ sentAtMs: _sentAtMs, ...sample }) => Object.freeze({ ...sample })),
    });
  }
}
