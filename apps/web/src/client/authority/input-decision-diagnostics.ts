import type { InputCommand, SequenceDecision } from '@seedlands/stdlib/runtime/session-protocol';

type InputDecision = Readonly<{ sequence: number; decision: SequenceDecision; requiresResync: boolean }>;
type AuthorityObservation = Readonly<{ authorityPhysicsTick: number; receivedAtTimeOriginMs: number }>;
type CommandObservation = Readonly<{
  sequence: number;
  targetPhysicsTick: number;
  issuedAtMs: number;
  movementRevision: InputCommand['movementRevision'];
  postedAtTimeOriginMs: number;
  state: Readonly<InputCommand['state']>;
  edges: Readonly<InputCommand['edges']>;
}>;
type ReceiptObservation = InputDecision &
  Readonly<{
    command: CommandObservation | null;
    authority: AuthorityObservation | null;
  }>;
type RejectedReceipt = { receipt: ReceiptObservation; recovery: ReceiptObservation | null };
export type InputDecisionDiagnostics = Readonly<{
  boundary: 'accepted-receipts-for-client-lifetime';
  lastSequence: number;
  totalReceipts: number;
  resyncReceipts: number;
  byDecision: Readonly<Partial<Record<SequenceDecision, number>>>;
  recentReceipts: readonly ReceiptObservation[];
  rejectedReceipts: readonly Readonly<RejectedReceipt>[];
}>;
type State = {
  lastSequence: number;
  total: number;
  resync: number;
  counts: Map<SequenceDecision, number>;
  commands: Map<number, CommandObservation>;
  recent: ReceiptObservation[];
  rejected: RejectedReceipt[];
  pendingRecovery: RejectedReceipt[];
};
const states = new WeakMap<object, State>();
const MAX_RECENT = 256;
const MAX_REJECTED = 128;
const stateFor = (client: object): State => {
  let state = states.get(client);
  if (!state) {
    state = {
      lastSequence: -1,
      total: 0,
      resync: 0,
      counts: new Map(),
      commands: new Map(),
      recent: [],
      rejected: [],
      pendingRecovery: [],
    };
    states.set(client, state);
  }
  return state;
};

/** Records only a bounded independent command copy, before a potentially reentrant post. */
function recordInputCommand(client: object, command: InputCommand): void {
  if (!Number.isSafeInteger(command.sequence) || !command.state || !command.edges) return;
  const state = stateFor(client);
  state.commands.set(command.sequence, {
    sequence: command.sequence,
    targetPhysicsTick: command.targetPhysicsTick,
    issuedAtMs: command.issuedAtMs,
    movementRevision: command.movementRevision,
    postedAtTimeOriginMs: performance.timeOrigin + performance.now(),
    state: {
      moveX: command.state.moveX,
      moveZ: command.state.moveZ,
      verticalIntent: command.state.verticalIntent,
      jumpHeld: command.state.jumpHeld,
    },
    edges: { jumpPressed: command.edges.jumpPressed },
  });
  while (state.commands.size > MAX_RECENT) state.commands.delete(state.commands.keys().next().value!);
}

export function postInputCommand(client: object, command: InputCommand, post: () => void): void {
  recordInputCommand(client, command);
  try {
    post();
  } catch (error) {
    states.get(client)?.commands.delete(command.sequence);
    throw error;
  }
}
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

/** Called only after the production router accepts a new decision receipt. */
function recordInputDecision(
  client: object,
  receipt: InputDecision & Readonly<{ observation?: AuthorityObservation }>,
): void {
  if (!Number.isSafeInteger(receipt.sequence) || !decisions.has(receipt.decision)) return;
  const state = stateFor(client);
  state.lastSequence = receipt.sequence;
  state.total += 1;
  state.resync += Number(receipt.requiresResync === true);
  state.counts.set(receipt.decision, (state.counts.get(receipt.decision) ?? 0) + 1);
  const observation = receipt.observation;
  const authority =
    observation &&
    Number.isSafeInteger(observation.authorityPhysicsTick) &&
    observation.authorityPhysicsTick >= 0 &&
    Number.isFinite(observation.receivedAtTimeOriginMs) &&
    observation.receivedAtTimeOriginMs >= 0
      ? {
          authorityPhysicsTick: observation.authorityPhysicsTick,
          receivedAtTimeOriginMs: observation.receivedAtTimeOriginMs,
        }
      : null;
  const entry: ReceiptObservation = {
    sequence: receipt.sequence,
    decision: receipt.decision,
    requiresResync: receipt.requiresResync,
    command: state.commands.get(receipt.sequence) ?? null,
    authority,
  };
  for (const sequence of state.commands.keys()) if (sequence <= receipt.sequence) state.commands.delete(sequence);
  state.recent.push(entry);
  if (state.recent.length > MAX_RECENT) state.recent.shift();
  if (receipt.decision === 'accepted') {
    for (const rejected of state.pendingRecovery) rejected.recovery = entry;
    state.pendingRecovery = [];
  } else if (receipt.decision !== 'duplicate') {
    const rejected = { receipt: entry, recovery: null };
    state.rejected.push(rejected);
    state.pendingRecovery.push(rejected);
    if (state.rejected.length > MAX_REJECTED) {
      const dropped = state.rejected.shift();
      state.pendingRecovery = state.pendingRecovery.filter((pending) => pending !== dropped);
    }
  }
}

export function deliverInputDecision(
  client: object,
  receipt: InputDecision & Readonly<{ observation?: AuthorityObservation }>,
  callback?: (decision: InputDecision) => void,
): void {
  const decision = { sequence: receipt.sequence, decision: receipt.decision, requiresResync: receipt.requiresResync };
  recordInputDecision(client, receipt);
  callback?.(decision);
}

export function readInputDecisionDiagnostics(client: object | null): InputDecisionDiagnostics | null {
  if (!client) return null;
  const state = states.get(client);
  const copy = (receipt: ReceiptObservation): ReceiptObservation =>
    Object.freeze({
      ...receipt,
      command: receipt.command
        ? Object.freeze({
            ...receipt.command,
            state: Object.freeze({ ...receipt.command.state }),
            edges: Object.freeze({ ...receipt.command.edges }),
          })
        : null,
      authority: receipt.authority ? Object.freeze({ ...receipt.authority }) : null,
    });
  return Object.freeze({
    boundary: 'accepted-receipts-for-client-lifetime',
    lastSequence: state?.lastSequence ?? -1,
    totalReceipts: state?.total ?? 0,
    resyncReceipts: state?.resync ?? 0,
    byDecision: Object.freeze(Object.fromEntries(state?.counts ?? [])),
    recentReceipts: Object.freeze((state?.recent ?? []).map(copy)),
    rejectedReceipts: Object.freeze(
      (state?.rejected ?? []).map((entry) =>
        Object.freeze({
          receipt: copy(entry.receipt),
          recovery: entry.recovery ? copy(entry.recovery) : null,
        }),
      ),
    ),
  });
}
