export type CompletedPersistenceWorkerTask = Readonly<{
  kind: string;
  startedAtEpochMs: number;
  completedAtEpochMs: number;
  encodeMs?: number;
}>;

export type PersistenceMailboxBlocker = Readonly<{
  mailboxBlockerKind: string;
  mailboxBlockerOverlapMs: number;
  mailboxBlockerEncodeMs?: number;
}>;

export function describePersistenceMailboxBlocker(
  requestSentAtEpochMs: number,
  requestReceivedAtEpochMs: number,
  previous: CompletedPersistenceWorkerTask | undefined,
): PersistenceMailboxBlocker | undefined {
  if (
    !previous ||
    previous.completedAtEpochMs <= requestSentAtEpochMs ||
    previous.completedAtEpochMs > requestReceivedAtEpochMs
  )
    return undefined;
  const overlapStartedAtEpochMs = Math.max(previous.startedAtEpochMs, requestSentAtEpochMs);
  if (previous.completedAtEpochMs <= overlapStartedAtEpochMs) return undefined;
  return {
    mailboxBlockerKind: previous.kind,
    mailboxBlockerOverlapMs: previous.completedAtEpochMs - overlapStartedAtEpochMs,
    ...(previous.encodeMs === undefined ? {} : { mailboxBlockerEncodeMs: previous.encodeMs }),
  };
}
