import { expect, it } from 'vitest';
import { captureRemoteMeshTrace } from '../../apps/web/src/app/world/remote-playable-evidence';
import { PerformanceTelemetry } from '../../apps/web/src/client/presentation/performance-telemetry';

it('远端区块诊断只导出关联事件的安全字段并保留最近64条', () => {
  let now = 0;
  const telemetry = new PerformanceTelemetry({ now: () => now, eventCapacity: 256 });
  const traceId = telemetry.beginTrace('chunk-request', '-1,0,-1', 'main');
  telemetry.beginTrace('chunk-request', '0,0,0', 'main');
  for (let index = 0; index < 70; index += 1) {
    now += 1;
    telemetry.recordCompletedSpan({
      name: 'MeshPreparationFailure',
      category: 'worker',
      lane: 'main',
      durationMs: 1,
      traceId,
      attributes: { errorMessage: 'synthetic-private-detail', other: 'discard-me' },
    });
  }
  const result = captureRemoteMeshTrace(
    {
      exportTrace: () => telemetry.exportChromeTrace(),
      telemetry: {
        loadedChunks: 1,
        renderedChunks: 1,
        generationQueue: 0,
        meshingQueue: 0,
        uploadQueue: 0,
        deferredRemeshes: 0,
        triangles: 2,
        drawCalls: 1,
        meshBytes: 128,
      },
      transactionDiagnostics: {
        worldRevision: 2,
        structuralEventCount: 1,
        remeshSchedulingCount: 1,
        lastCommitMutationCount: 1,
        lastCommitMeshChunkCount: 1,
      },
    },
    -1,
    20,
    -2,
  );
  expect(result.key).toBe('-1,0,-1');
  expect(result.eventCount).toBe(71);
  expect(result.events).toHaveLength(64);
  expect(result.events[0].ts).toBe(6_000);
  expect(result.events.at(-1)?.ts).toBe(69_000);
  expect(result.events.every((event) => event.args?.traceId === traceId)).toBe(true);
  expect(JSON.stringify(result)).not.toContain('synthetic-private-detail');
  expect(JSON.stringify(result)).not.toContain('discard-me');
});
