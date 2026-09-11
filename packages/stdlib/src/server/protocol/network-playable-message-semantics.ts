import type { PublicSessionRef } from './network-message-semantics';

export type PlayablePublicOutboundMessage =
  | Readonly<{
      kind: 'authority-state';
      ref: PublicSessionRef;
      publicationSequence: number;
      correction: Readonly<Record<string, unknown>>;
      gameplay?: Readonly<Record<string, unknown>>;
      commits: readonly Readonly<Record<string, unknown>>[];
    }>
  | Readonly<{
      kind: 'input-decision';
      ref: PublicSessionRef;
      inputSequence: number;
      decision: string;
      requiresResync: boolean;
    }>
  | Readonly<{
      kind: 'action-receipt';
      ref: PublicSessionRef;
      requestId: number;
      receipt: Readonly<Record<string, unknown>>;
      gameplay?: Readonly<Record<string, unknown>>;
      commits: readonly Readonly<Record<string, unknown>>[];
    }>
  | Readonly<{
      kind: 'baseline-descriptor';
      ref: PublicSessionRef;
      requestId: number;
      descriptor: Readonly<Record<string, unknown>>;
    }>
  | Readonly<{
      kind: 'baseline-page';
      ref: PublicSessionRef;
      requestId: number;
      page: Readonly<Record<string, unknown>>;
      payloadBlock: 'payload';
    }>
  | Readonly<{
      kind: 'baseline-unavailable';
      ref: PublicSessionRef;
      requestId: number;
      reason: string;
    }>
  | Readonly<{ kind: 'heartbeat-receipt'; ref: PublicSessionRef; nonce: number }>;

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const only = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const projections = (value: unknown, kind: string, maximum = 512) =>
  Array.isArray(value) && value.length <= maximum && value.every((entry) => record(entry) && entry.kind === kind);

export function isPlayablePublicOutboundMessage(
  value: Record<string, unknown>,
  sessionRef: (value: unknown) => value is PublicSessionRef,
): value is Record<string, unknown> & PlayablePublicOutboundMessage {
  if (!sessionRef(value.ref)) return false;
  if (value.kind === 'authority-state')
    return (
      only(value, ['kind', 'ref', 'publicationSequence', 'correction', 'gameplay', 'commits']) &&
      integer(value.publicationSequence) &&
      record(value.correction) &&
      value.correction.kind === 'player-correction-reference' &&
      (value.gameplay === undefined ||
        (record(value.gameplay) && value.gameplay.kind === 'gameplay-consumer-reference')) &&
      projections(value.commits, 'world-commit-presentation-reference')
    );
  if (value.kind === 'input-decision')
    return (
      only(value, ['kind', 'ref', 'inputSequence', 'decision', 'requiresResync']) &&
      integer(value.inputSequence) &&
      [
        'accepted',
        'invalid',
        'duplicate',
        'out-of-order',
        'late',
        'target-out-of-order',
        'too-far-ahead',
        'capacity',
      ].includes(value.decision as string) &&
      typeof value.requiresResync === 'boolean'
    );
  if (value.kind === 'action-receipt')
    return (
      only(value, ['kind', 'ref', 'requestId', 'receipt', 'gameplay', 'commits']) &&
      integer(value.requestId) &&
      record(value.receipt) &&
      value.receipt.kind === 'action-receipt-reference' &&
      (value.gameplay === undefined ||
        (record(value.gameplay) && value.gameplay.kind === 'gameplay-consumer-reference')) &&
      projections(value.commits, 'world-commit-presentation-reference')
    );
  if (value.kind === 'baseline-descriptor')
    return (
      only(value, ['kind', 'ref', 'requestId', 'descriptor']) &&
      integer(value.requestId) &&
      record(value.descriptor) &&
      value.descriptor.kind === 'baseline-bundle-descriptor-reference'
    );
  if (value.kind === 'baseline-page')
    return (
      only(value, ['kind', 'ref', 'requestId', 'page', 'payloadBlock']) &&
      integer(value.requestId) &&
      value.payloadBlock === 'payload' &&
      record(value.page) &&
      value.page.kind === 'baseline-page-reference' &&
      !Object.hasOwn(value.page, 'bytes')
    );
  if (value.kind === 'baseline-unavailable')
    return only(value, ['kind', 'ref', 'requestId', 'reason']) && integer(value.requestId) && text(value.reason);
  return value.kind === 'heartbeat-receipt' && only(value, ['kind', 'ref', 'nonce']) && integer(value.nonce);
}
