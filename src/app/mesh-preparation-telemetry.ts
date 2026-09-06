import type { PerformanceTelemetry } from '../client/performance-telemetry';
import type { WorkerInput } from './mesh-task-dispatch';

export function recordMeshPreparationDiagnostics(
  telemetry: PerformanceTelemetry,
  traceId: string,
  diagnostics: WorkerInput['preparationDiagnostics'],
): void {
  if (!diagnostics) return;
  const record = (
    name: string,
    durationMs: number,
    lane: string,
    attributes?: Readonly<Record<string, string | number>>,
  ) =>
    telemetry.recordCompletedSpan({
      category: 'persistence',
      name,
      lane,
      durationMs,
      traceId,
      ...(attributes ? { attributes } : {}),
    });
  record('AuthorityPrepare', diagnostics.authorityPrepareMs, 'authority-worker');
  record('AuthorityPersistenceWait', diagnostics.persistenceWaitMs, 'authority-worker', {
    sharedDependencyCount: diagnostics.persistence?.sharedDependencyCount ?? 0,
  });
  record('AuthoritySnapshotCopy', diagnostics.snapshotCopyMs, 'authority-worker');
  if (!diagnostics.persistence) return;
  const persistence = diagnostics.persistence;
  record('PersistenceTaskQueue', persistence.queueWaitMs, 'persistence-worker');
  record('PersistenceDatabase', persistence.databaseMs, 'persistence-worker');
  record('PersistenceTransactionRead', persistence.transactionReadMs, 'persistence-worker');
  record('PersistenceBatchDecode', persistence.decodeMs, 'persistence-worker');
  record('PersistenceWorkerLoad', persistence.totalWorkerMs, 'persistence-worker', {
    requestedKeyCount: persistence.requestedKeyCount,
    foundCount: persistence.foundCount,
    missingCount: persistence.missingCount,
    codecs: Object.entries(persistence.codecs)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([codec, count]) => `${codec}:${count}`)
      .join(','),
  });
  if (persistence.mailboxWaitMs !== undefined)
    record('PersistenceMailboxWait', persistence.mailboxWaitMs, 'persistence-worker', {
      ...(persistence.mailboxEncodingTaskKind ? { encodingTaskKind: persistence.mailboxEncodingTaskKind } : {}),
      ...(persistence.mailboxEncodingOverlapMs === undefined
        ? {}
        : { encodingOverlapMs: persistence.mailboxEncodingOverlapMs }),
      ...(persistence.mailboxEncodingDurationMs === undefined
        ? {}
        : { encodingDurationMs: persistence.mailboxEncodingDurationMs }),
    });
  if (persistence.replyDeliveryMs !== undefined)
    record('PersistenceReplyDelivery', persistence.replyDeliveryMs, 'authority-worker');
  if (persistence.roundTripMs !== undefined)
    record('PersistenceRoundTrip', persistence.roundTripMs, 'authority-worker');
}
