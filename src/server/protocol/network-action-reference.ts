import type { AuthorityTransactionReceipt } from '../authority/authority-runtime-types';
import type { AuthorityAction } from '../../worker/authority-worker-protocol';
import { NETWORK_REFERENCE_PROJECTION_VERSION } from './network-reference-projection-types';

const reasonsByAction = {
  'select-hotbar': ['invalid-slot'],
  'cancel-break': [],
  respawn: ['player-alive'],
  craft: ['player-dead', 'unknown-recipe', 'missing-inputs', 'no-output-capacity'],
  'begin-break': ['player-dead', 'out-of-range', 'chunk-unavailable', 'unbreakable'],
  attack: ['player-dead', 'cooldown', 'invalid-target', 'out-of-range', 'chunk-unavailable', 'blocked'],
  place: [
    'player-dead',
    'out-of-range',
    'chunk-unavailable',
    'target-occupied',
    'no-selected-item',
    'item-not-placeable',
    'player-collision',
    'world-not-changed',
  ],
  'move-inventory': ['player-dead', 'cannot-move-item'],
  'use-inventory': ['player-dead', 'invalid-slot', 'no-selected-item', 'item-not-usable', 'hunger-full'],
} as const satisfies Record<AuthorityAction['type'], readonly string[]>;
type ActionFailureReason = (typeof reasonsByAction)[AuthorityAction['type']][number];
type ActionOutcomeReference =
  | Readonly<{ success: false; reason: ActionFailureReason }>
  | Readonly<{ success: true; recipeId?: string; requiredSeconds?: number; damage?: number; worldRevision?: number }>;
type ReceiptIdentity = Readonly<{ epoch: string; issuer: string; stream: string; sequence: number }>;
type ReceiptBase = Readonly<{
  kind: 'action-receipt-reference';
  projectionVersion: typeof NETWORK_REFERENCE_PROJECTION_VERSION;
  transaction: ReceiptIdentity;
  /** 此参考投影没有查询持久化；null 表示未知，不表示尚未保存。 */
  durableCommitSequence: null;
}>;
export type ActionReceiptReference = ReceiptBase &
  (
    | Readonly<{ status: 'conflict' | 'expired' | 'capacity'; observedCommitSequence: number }>
    | Readonly<{
        status: 'executed';
        action: AuthorityAction;
        executedCommitSequence: number;
        gameplayRevision: number;
        committedWorldRevisions: readonly number[];
        outcome: ActionOutcomeReference;
      }>
  );

const record = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid ${field}.`);
  return value as Record<string, unknown>;
};
const text = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new TypeError(`Invalid ${field}.`);
  return value;
};
const number = (value: unknown, field: string, integer = true): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value)))
    throw new TypeError(`Invalid ${field}.`);
  return value;
};

function outcome(action: AuthorityAction, value: unknown): ActionOutcomeReference {
  const source = record(value, 'action outcome');
  if (source.success === false) {
    if (!(reasonsByAction[action.type] as readonly unknown[]).includes(source.reason))
      throw new TypeError('Unrecognized action reason.');
    return { success: false, reason: source.reason as ActionFailureReason };
  }
  if (source.success !== true) throw new TypeError('Invalid action success.');
  switch (action.type) {
    case 'craft': {
      const recipeId = text(record(source.recipe, 'recipe').id, 'recipe.id');
      if (recipeId !== action.recipeId) throw new TypeError('Action recipe does not match receipt.');
      return { success: true, recipeId };
    }
    case 'begin-break':
      return { success: true, requiredSeconds: number(source.requiredSeconds, 'requiredSeconds', false) };
    case 'attack':
      return { success: true, damage: number(source.damage, 'damage', false) };
    case 'place': {
      const commit = record(source.commit, 'place commit');
      if (commit.committed !== true) throw new TypeError('Successful placement requires a committed world change.');
      return { success: true, worldRevision: number(commit.worldRevision, 'place worldRevision') };
    }
    case 'select-hotbar':
    case 'cancel-break':
    case 'respawn':
    case 'move-inventory':
    case 'use-inventory':
      return { success: true };
    default:
      throw new TypeError('Unsupported public action.');
  }
}

/** 参考投影不传 unknown result；事务执行成功与 gameplay 业务成功分别表达。 */
export function projectActionReceiptReference(
  action: AuthorityAction,
  receipt: AuthorityTransactionReceipt<unknown>,
  identity: ReceiptIdentity,
): ActionReceiptReference {
  const canonicalAction = (value: unknown): AuthorityAction => {
    const candidate = record(value, 'submitted action');
    if (typeof candidate.type !== 'string' || !Object.hasOwn(reasonsByAction, candidate.type))
      throw new TypeError('Unsupported public action.');
    const request = value as AuthorityAction;
    switch (request.type) {
      case 'cancel-break':
      case 'respawn':
        return { type: request.type };
      case 'select-hotbar':
      case 'use-inventory':
        return { type: request.type, slot: number(request.slot, 'slot') };
      case 'craft':
        return { type: request.type, recipeId: text(request.recipeId, 'recipeId') };
      case 'attack':
        return { type: request.type, targetId: text(request.targetId, 'targetId') };
      case 'move-inventory':
        return {
          type: request.type,
          source: number(request.source, 'source'),
          target: number(request.target, 'target'),
        };
      case 'begin-break':
      case 'place': {
        if (
          !Array.isArray(request.position) ||
          request.position.length !== 3 ||
          !request.position.every(Number.isSafeInteger)
        )
          throw new TypeError('Invalid action position.');
        return { type: request.type, position: [...request.position] };
      }
    }
  };
  const base: ReceiptBase = {
    kind: 'action-receipt-reference',
    projectionVersion: NETWORK_REFERENCE_PROJECTION_VERSION,
    transaction: {
      epoch: text(identity.epoch, 'epoch'),
      issuer: text(identity.issuer, 'issuer'),
      stream: text(identity.stream, 'stream'),
      sequence: number(identity.sequence, 'sequence'),
    },
    durableCommitSequence: null,
  };
  if (receipt.status !== 'executed') {
    if (!['conflict', 'expired', 'capacity'].includes(receipt.status))
      throw new TypeError('Invalid transaction status.');
    return {
      ...base,
      status: receipt.status,
      observedCommitSequence: number(receipt.commitSequence, 'commitSequence'),
    };
  }
  const publicAction = canonicalAction(action);
  const result = record(receipt.result, 'authority action result');
  const submittedAction = canonicalAction(result.submittedAction);
  if (JSON.stringify(submittedAction) !== JSON.stringify(publicAction))
    throw new TypeError('Transaction action does not match its original receipt.');
  const gameplay = record(result.gameplay, 'gameplay');
  if (!Array.isArray(result.commits)) throw new TypeError('Invalid committed world revisions.');
  const committedWorldRevisions = result.commits
    .filter((value) => record(value, 'commit').committed === true)
    .map((value) => number(record(value, 'commit').worldRevision, 'worldRevision'));
  const publicOutcome = outcome(submittedAction, result.result);
  if (
    publicOutcome.success &&
    publicOutcome.worldRevision !== undefined &&
    !committedWorldRevisions.includes(publicOutcome.worldRevision)
  )
    throw new TypeError('Placement revision is missing from committed revisions.');
  return {
    ...base,
    status: 'executed',
    action: submittedAction,
    executedCommitSequence: number(receipt.commitSequence, 'commitSequence'),
    gameplayRevision: number(gameplay.gameplayRevision, 'gameplayRevision'),
    committedWorldRevisions,
    outcome: publicOutcome,
  };
}
