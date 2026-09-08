export type PersistenceWorkerEncoding = Readonly<{
  kind: string;
  encodeStartedAtEpochMs: number;
  encodeCompletedAtEpochMs: number;
}>;

export type PersistenceMailboxEncoding = Readonly<{
  mailboxEncodingTaskKind: string;
  mailboxEncodingOverlapMs: number;
  mailboxEncodingDurationMs: number;
}>;

export function describePersistenceMailboxEncoding(
  requestSentAtEpochMs: number,
  requestReceivedAtEpochMs: number,
  encoding: PersistenceWorkerEncoding | undefined,
): PersistenceMailboxEncoding | undefined {
  if (!encoding) return undefined;
  const overlapStartedAtEpochMs = Math.max(encoding.encodeStartedAtEpochMs, requestSentAtEpochMs);
  const overlapCompletedAtEpochMs = Math.min(encoding.encodeCompletedAtEpochMs, requestReceivedAtEpochMs);
  if (overlapCompletedAtEpochMs <= overlapStartedAtEpochMs) return undefined;
  return {
    mailboxEncodingTaskKind: encoding.kind,
    mailboxEncodingOverlapMs: overlapCompletedAtEpochMs - overlapStartedAtEpochMs,
    mailboxEncodingDurationMs: encoding.encodeCompletedAtEpochMs - encoding.encodeStartedAtEpochMs,
  };
}
