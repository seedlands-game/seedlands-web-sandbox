import type { ChromeTrace } from '../../../src/client/performance-telemetry';

type TraceEvent = ChromeTrace['traceEvents'][number];

export function selectAuthorityLoadTrace(
  traceEvents: readonly TraceEvent[],
  targetChunkKey: string,
  targetTraceId: string | undefined,
): Readonly<{ targetChunkTrace: TraceEvent[]; globalPreparationTraceWindow: TraceEvent[] }> {
  const targetChunkTrace = traceEvents
    .filter((event) => event.name === targetChunkKey || event.args?.traceId === targetTraceId)
    .slice(-64);
  const requested = targetChunkTrace.find(
    (event) => event.name === 'requested' && event.args?.traceId === targetTraceId,
  );
  const prepareStarted = targetChunkTrace.find(
    (event) => event.name === 'prepare-start' && event.args?.traceId === targetTraceId,
  );
  const globalPreparationTraceWindow =
    requested && prepareStarted
      ? traceEvents.filter(
          (event) =>
            event.ts <= prepareStarted.ts + 1_000_000 && event.ts + event.dur >= Math.max(0, requested.ts - 1_000_000),
        )
      : [];
  return { targetChunkTrace, globalPreparationTraceWindow };
}
