import type { InputCommand } from '@seedlands/game-core/runtime/session-protocol';
import type { SequenceDecision } from '@seedlands/game-core/runtime/session-protocol';
import type {
  PublicInboundMessage,
  PublicSessionRef,
} from '@seedlands/game-core/server/protocol/network-message-semantics';
import {
  RemoteAuthorityInputDiagnostics,
  type RemoteInputDiagnosticSummary,
} from './remote-authority-input-diagnostics';

export type PendingRemoteInput = Readonly<{ command: InputCommand; jumpExpiresAtMs: number | null }>;
export type RemoteInputDecisionResult =
  Readonly<{ matched: false }> | Readonly<{ matched: true; next: PendingRemoteInput | null }>;
// Node accepts an equal target, rejects regression, and caps targets at its current tick + 120.
const MAX_REMOTE_INPUT_FUTURE_TICKS = 120;

export class RemoteAuthorityInputPipeline {
  private inFlightSequence: number | null = null;
  private lastSentSequence = -1;
  private lastSentTargetPhysicsTick = -1;
  private queued: PendingRemoteInput | null = null;
  private diagnostics: RemoteAuthorityInputDiagnostics | null = null;

  submit(command: InputCommand, now: number, jumpLeaseMs: number): PendingRemoteInput | null {
    const latestSequence = this.queued?.command.sequence ?? this.lastSentSequence;
    if (command.sequence <= latestSequence) return null;
    const jumpExpiresAtMs = command.edges.jumpPressed ? now + jumpLeaseMs : null;
    const pending = {
      command,
      jumpExpiresAtMs:
        jumpExpiresAtMs === null
          ? (this.queued?.jumpExpiresAtMs ?? null)
          : Math.max(jumpExpiresAtMs, this.queued?.jumpExpiresAtMs ?? jumpExpiresAtMs),
    };
    if (this.inFlightSequence !== null) {
      this.queued = pending;
      return null;
    }
    this.markInFlight(pending);
    return pending;
  }

  acceptDecision(
    input: Readonly<{ inputSequence: number; decision: SequenceDecision; requiresResync: boolean }>,
    now: number,
  ): RemoteInputDecisionResult {
    const { inputSequence, decision, requiresResync } = input;
    if (inputSequence !== this.inFlightSequence) {
      this.diagnostics?.ignoredDecision();
      return { matched: false };
    }
    this.diagnostics?.matchedDecision(inputSequence, decision, requiresResync, now);
    this.inFlightSequence = null;
    if (requiresResync) this.queued = null;
    if (!this.queued) return { matched: true, next: null };
    const pending = this.queued;
    this.queued = null;
    this.markInFlight(pending);
    return { matched: true, next: pending };
  }

  clear(): void {
    this.inFlightSequence = null;
    this.queued = null;
    this.lastSentTargetPhysicsTick = -1;
  }

  project(
    input: PendingRemoteInput,
    ref: PublicSessionRef,
    timing: Readonly<{
      now: number;
      snapshotReceivedAtMs: number;
      snapshotPhysicsTick: number;
      physicsHz: number;
    }>,
  ): ReturnType<typeof projectRemoteInput> {
    return projectRemoteInput(input, ref, {
      ...timing,
      minimumTargetPhysicsTick: this.lastSentTargetPhysicsTick,
    });
  }

  recordSent(
    projected: ReturnType<typeof projectRemoteInput>,
    snapshotPhysicsTick: number,
    snapshotReceivedAtMs: number,
    now: number,
    diagnosticsEnabled: boolean,
  ): void {
    this.lastSentTargetPhysicsTick = projected.state.targetPhysicsTick;
    if (diagnosticsEnabled) this.diagnostics ??= new RemoteAuthorityInputDiagnostics();
    this.diagnostics?.sent(projected, snapshotPhysicsTick, snapshotReceivedAtMs, now);
  }

  diagnosticSummary(): RemoteInputDiagnosticSummary | null {
    return this.diagnostics?.snapshot() ?? null;
  }

  private markInFlight(input: PendingRemoteInput): void {
    this.inFlightSequence = input.command.sequence;
    this.lastSentSequence = input.command.sequence;
  }
}

export function projectRemoteInput(
  input: PendingRemoteInput,
  ref: PublicSessionRef,
  timing: Readonly<{
    now: number;
    snapshotReceivedAtMs: number;
    snapshotPhysicsTick: number;
    physicsHz: number;
    minimumTargetPhysicsTick?: number;
  }>,
): Readonly<{
  edge: Omit<Extract<PublicInboundMessage, { kind: 'input-edge' }>, 'edgeId'> | null;
  state: Extract<PublicInboundMessage, { kind: 'input-state' }>;
}> {
  const elapsedTicks = Math.ceil(((timing.now - timing.snapshotReceivedAtMs) * timing.physicsHz) / 1_000);
  const targetPhysicsTick = Math.min(
    timing.snapshotPhysicsTick + MAX_REMOTE_INPUT_FUTURE_TICKS,
    Math.max(
      input.command.targetPhysicsTick,
      timing.snapshotPhysicsTick + elapsedTicks + 2,
      timing.minimumTargetPhysicsTick ?? -1,
    ),
  );
  const expiresAfterPhysicsTick = targetPhysicsTick + Math.max(2, Math.ceil(timing.physicsHz / 2));
  return {
    edge:
      input.jumpExpiresAtMs !== null && timing.now <= input.jumpExpiresAtMs
        ? {
            kind: 'input-edge',
            ref,
            targetPhysicsTick,
            expiresAfterPhysicsTick,
            type: 'jump-pressed',
          }
        : null,
    state: {
      kind: 'input-state',
      ref,
      inputSequence: input.command.sequence,
      targetPhysicsTick,
      expiresAfterPhysicsTick,
      moveX: input.command.state.moveX,
      moveZ: input.command.state.moveZ,
      verticalIntent: input.command.state.verticalIntent,
      jumpHeld: input.command.state.jumpHeld,
    },
  };
}
