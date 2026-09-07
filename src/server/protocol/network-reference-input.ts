import type { AuthoritySnapshot } from '../authority/authority-session-types';
import { PROTOCOL_VERSION, type InputCommand, type SequenceDecision } from '../../runtime/session-protocol';
import type { InputDecisionReference, PlayerInputReference } from './network-reference-input-types';
import { NETWORK_REFERENCE_PROJECTION_VERSION } from './network-reference-projection-types';

const decisions = new Set<SequenceDecision>([
  'accepted',
  'invalid',
  'duplicate',
  'out-of-order',
  'late',
  'target-out-of-order',
  'too-far-ahead',
  'capacity',
  'wrong-epoch',
  'wrong-stream',
]);

const inputText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  return value;
};
const nonNegativeSafeInteger = (value: unknown, field: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new TypeError(`${field} must be a non-negative safe integer.`);
  return value as number;
};
const acknowledgement = (value: unknown, field: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < -1)
    throw new TypeError(`${field} must be a safe integer greater than or equal to -1.`);
  return value as number;
};

function copyValidatedInput(command: InputCommand): InputCommand {
  if (!command || command.kind !== 'input' || command.protocolVersion !== PROTOCOL_VERSION)
    throw new TypeError('input must use the current input protocol.');
  const state = command.state;
  const edges = command.edges;
  if (
    !state ||
    !Number.isFinite(state.moveX) ||
    Math.abs(state.moveX) > 1 ||
    !Number.isFinite(state.moveZ) ||
    Math.abs(state.moveZ) > 1 ||
    ![-1, 0, 1].includes(state.verticalIntent) ||
    typeof state.jumpHeld !== 'boolean' ||
    !edges ||
    typeof edges.jumpPressed !== 'boolean'
  )
    throw new TypeError('input state or edges are invalid.');
  if (!Number.isFinite(command.issuedAtMs)) throw new TypeError('input.issuedAtMs must be finite.');
  return {
    kind: 'input',
    protocolVersion: PROTOCOL_VERSION,
    epoch: inputText(command.epoch, 'input.epoch'),
    stream: inputText(command.stream, 'input.stream'),
    sequence: nonNegativeSafeInteger(command.sequence, 'input.sequence'),
    targetPhysicsTick: nonNegativeSafeInteger(command.targetPhysicsTick, 'input.targetPhysicsTick'),
    issuedAtMs: command.issuedAtMs,
    state: {
      moveX: state.moveX,
      moveZ: state.moveZ,
      verticalIntent: state.verticalIntent,
      jumpHeld: state.jumpHeld,
    },
    edges: { jumpPressed: edges.jumpPressed },
  };
}

export function projectPlayerInputReference(input: InputCommand): PlayerInputReference {
  return {
    kind: 'player-input-reference',
    projectionVersion: NETWORK_REFERENCE_PROJECTION_VERSION,
    input: copyValidatedInput(input),
  };
}

export function projectInputDecisionReference(
  input: InputCommand,
  decision: SequenceDecision,
  snapshot: AuthoritySnapshot,
): InputDecisionReference {
  const command = copyValidatedInput(input);
  if (!decisions.has(decision)) throw new TypeError('input decision is invalid.');
  if (!snapshot || typeof snapshot.inputResyncRequired !== 'boolean')
    throw new TypeError('snapshot.inputResyncRequired must be boolean.');
  const serverEpoch = inputText(snapshot.epoch, 'snapshot.epoch');
  const observedAcknowledgedInputSequence = acknowledgement(
    snapshot.acknowledgedInputSequence,
    'snapshot.acknowledgedInputSequence',
  );
  if (decision === 'accepted') {
    if (command.epoch !== serverEpoch) throw new TypeError('accepted input must match the server epoch.');
    if (command.stream !== 'player-input') throw new TypeError('accepted input must use the player-input stream.');
    if (observedAcknowledgedInputSequence >= command.sequence)
      throw new TypeError('accepted input must be observed before its sequence is acknowledged.');
    if (snapshot.inputResyncRequired) throw new TypeError('accepted input must clear input resync state.');
  }
  if (decision === 'wrong-epoch' && command.epoch === serverEpoch)
    throw new TypeError('wrong-epoch input must differ from the server epoch.');
  if (decision === 'wrong-stream' && (command.epoch !== serverEpoch || command.stream === 'player-input'))
    throw new TypeError('wrong-stream input must match the server epoch and use another stream.');
  return {
    kind: 'input-decision-reference',
    projectionVersion: NETWORK_REFERENCE_PROJECTION_VERSION,
    epoch: serverEpoch,
    input: {
      epoch: command.epoch,
      stream: command.stream,
      sequence: command.sequence,
      targetPhysicsTick: command.targetPhysicsTick,
    },
    decision,
    observedPhysicsTick: nonNegativeSafeInteger(snapshot.physicsTick, 'snapshot.physicsTick'),
    observedAcknowledgedInputSequence,
    inputResyncRequired: snapshot.inputResyncRequired,
  };
}
