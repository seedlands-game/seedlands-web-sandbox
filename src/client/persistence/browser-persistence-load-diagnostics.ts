import type { ChunkPersistenceLoadDiagnostics } from '../../server/persistence/chunk-persistence';

export type BrowserPersistenceLoadBatchResult = Readonly<{
  entries: readonly unknown[];
  diagnostics: ChunkPersistenceLoadDiagnostics;
  responsePostedAtEpochMs: number;
}>;

const isNonNegativeFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isNonNegativeInteger = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0;

export function parseBrowserPersistenceLoadBatchResult(
  value: unknown,
  expectedKeyCount: number,
): BrowserPersistenceLoadBatchResult {
  if (!value || typeof value !== 'object') throw new Error('Persistence load batch result is invalid.');
  const { entries, diagnostics, responsePostedAtEpochMs } = value as {
    entries?: unknown;
    diagnostics?: unknown;
    responsePostedAtEpochMs?: unknown;
  };
  if (!Array.isArray(entries) || entries.length !== expectedKeyCount)
    throw new Error('Persistence load batch result length does not match its request.');
  if (!diagnostics || typeof diagnostics !== 'object')
    throw new Error('Persistence load batch diagnostics are invalid.');
  const parsed = diagnostics as Record<string, unknown>;
  if (
    !isNonNegativeInteger(parsed.requestedKeyCount) ||
    !isNonNegativeInteger(parsed.foundCount) ||
    !isNonNegativeInteger(parsed.missingCount) ||
    parsed.requestedKeyCount !== expectedKeyCount ||
    Number(parsed.foundCount) + Number(parsed.missingCount) !== expectedKeyCount ||
    !isNonNegativeFinite(parsed.queueWaitMs) ||
    !isNonNegativeFinite(parsed.databaseMs) ||
    !isNonNegativeFinite(parsed.transactionReadMs) ||
    !isNonNegativeFinite(parsed.decodeMs) ||
    !isNonNegativeFinite(parsed.totalWorkerMs) ||
    !isNonNegativeFinite(parsed.mailboxWaitMs) ||
    (parsed.mailboxEncodingTaskKind !== undefined && typeof parsed.mailboxEncodingTaskKind !== 'string') ||
    (parsed.mailboxEncodingOverlapMs !== undefined && !isNonNegativeFinite(parsed.mailboxEncodingOverlapMs)) ||
    (parsed.mailboxEncodingDurationMs !== undefined && !isNonNegativeFinite(parsed.mailboxEncodingDurationMs)) ||
    !isNonNegativeFinite(responsePostedAtEpochMs) ||
    !parsed.codecs ||
    typeof parsed.codecs !== 'object' ||
    Array.isArray(parsed.codecs) ||
    !Object.values(parsed.codecs).every(isNonNegativeInteger)
  )
    throw new Error('Persistence load batch diagnostics are invalid.');
  return {
    entries,
    diagnostics: parsed as ChunkPersistenceLoadDiagnostics,
    responsePostedAtEpochMs: Number(responsePostedAtEpochMs),
  };
}

export function withBrowserPersistenceRoundTrip(
  diagnostics: ChunkPersistenceLoadDiagnostics,
  requestSentAtEpochMs: number,
  responsePostedAtEpochMs: number,
  responseReceivedAtEpochMs: number,
): ChunkPersistenceLoadDiagnostics {
  return {
    ...diagnostics,
    replyDeliveryMs: Math.max(0, responseReceivedAtEpochMs - responsePostedAtEpochMs),
    roundTripMs: Math.max(0, responseReceivedAtEpochMs - requestSentAtEpochMs),
  };
}
