import type { AuthoritySnapshot } from '@seedlands/game-core/server/authority/authority-session';
import type { SequenceDecision } from '@seedlands/game-core/runtime/session-protocol';
import type { PublicInboundMessage } from '@seedlands/game-core/server/protocol/network-message-semantics';

const MAX_SAMPLES = 16;

type MutableSample = {
  ordinal: number;
  inputSequence: number;
  targetPhysicsTick: number;
  currentTickAtAdmission: number;
  expiresAfterPhysicsTick: number;
  moveX: number;
  moveZ: number;
  decision: SequenceDecision | null;
};

export type NodePlayableInputDiagnosticSummary = Readonly<{
  kind: 'node-playable-input-summary';
  received: number;
  accepted: number;
  late: number;
  resync: number;
  decisions: Readonly<Record<SequenceDecision, number>>;
  samples: readonly Readonly<MutableSample>[];
  latestAuthorityPosition: readonly [number, number, number];
}>;

export class NodePlayableInputDiagnostics {
  private received = 0;
  private resync = 0;
  private readonly decisions: Record<SequenceDecision, number> = {
    accepted: 0,
    invalid: 0,
    duplicate: 0,
    'out-of-order': 0,
    late: 0,
    'target-out-of-order': 0,
    'too-far-ahead': 0,
    capacity: 0,
    'wrong-epoch': 0,
    'wrong-stream': 0,
  };
  private readonly samples: MutableSample[] = [];

  admit(message: Extract<PublicInboundMessage, { kind: 'input-state' }>, currentTick: number): MutableSample | null {
    this.received += 1;
    if (
      this.samples.length >= MAX_SAMPLES ||
      (message.moveX === 0 && message.moveZ === 0 && message.verticalIntent === 0 && !message.jumpHeld)
    )
      return null;
    const sample = {
      ordinal: this.samples.length + 1,
      inputSequence: message.inputSequence,
      targetPhysicsTick: message.targetPhysicsTick,
      currentTickAtAdmission: currentTick,
      expiresAfterPhysicsTick: message.expiresAfterPhysicsTick,
      moveX: message.moveX,
      moveZ: message.moveZ,
      decision: null,
    } satisfies MutableSample;
    this.samples.push(sample);
    return sample;
  }

  decide(sample: MutableSample | null, decision: SequenceDecision): void {
    this.decisions[decision] += 1;
    if (decision !== 'accepted' && decision !== 'duplicate') this.resync += 1;
    if (sample) sample.decision = decision;
  }

  summary(latest: AuthoritySnapshot): NodePlayableInputDiagnosticSummary {
    return Object.freeze({
      kind: 'node-playable-input-summary',
      received: this.received,
      accepted: this.decisions.accepted,
      late: this.decisions.late,
      resync: this.resync,
      decisions: { ...this.decisions },
      samples: this.samples.map((sample) => Object.freeze({ ...sample })),
      latestAuthorityPosition: [
        latest.player.body.position.x,
        latest.player.body.position.y,
        latest.player.body.position.z,
      ] as const,
    });
  }
}
