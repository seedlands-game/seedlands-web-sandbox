import type { SequenceDecision } from '@seedlands/stdlib/runtime/session-protocol';

type InputDecision = Readonly<{ sequence: number; decision: SequenceDecision; requiresResync: boolean }>;
export type InputDecisionDiagnostics = Readonly<{
  boundary: 'accepted-receipts-for-client-lifetime';
  lastSequence: number;
  totalReceipts: number;
  resyncReceipts: number;
  byDecision: Readonly<Partial<Record<SequenceDecision, number>>>;
}>;
type State = { lastSequence: number; total: number; resync: number; counts: Map<SequenceDecision, number> };
const states = new WeakMap<object, State>();
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
function recordInputDecision(client: object, receipt: InputDecision): void {
  if (!Number.isSafeInteger(receipt.sequence) || !decisions.has(receipt.decision)) return;
  const state = states.get(client) ?? { lastSequence: -1, total: 0, resync: 0, counts: new Map() };
  state.lastSequence = receipt.sequence;
  state.total += 1;
  state.resync += Number(receipt.requiresResync === true);
  state.counts.set(receipt.decision, (state.counts.get(receipt.decision) ?? 0) + 1);
  states.set(client, state);
}

export function deliverInputDecision(
  client: object,
  receipt: InputDecision,
  callback?: (decision: InputDecision) => void,
): void {
  const decision = { sequence: receipt.sequence, decision: receipt.decision, requiresResync: receipt.requiresResync };
  recordInputDecision(client, decision);
  callback?.(decision);
}

export function readInputDecisionDiagnostics(client: object | null): InputDecisionDiagnostics | null {
  if (!client) return null;
  const state = states.get(client);
  return Object.freeze({
    boundary: 'accepted-receipts-for-client-lifetime',
    lastSequence: state?.lastSequence ?? -1,
    totalReceipts: state?.total ?? 0,
    resyncReceipts: state?.resync ?? 0,
    byDecision: Object.freeze(Object.fromEntries(state?.counts ?? [])),
  });
}
