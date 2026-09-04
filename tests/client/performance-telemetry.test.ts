import { describe, expect, it } from 'vitest';
import { PerformanceTelemetry } from '../../src/client/performance-telemetry';

describe('客户端性能 telemetry', () => {
  it('记录嵌套 span、帧分位数和有界 ring buffer', () => {
    let now = 0;
    const telemetry = new PerformanceTelemetry({ now: () => now, frameCapacity: 2, eventCapacity: 4 });

    telemetry.beginFrame();
    const streaming = telemetry.beginSpan('streaming', 'Streaming');
    now += 2;
    telemetry.endSpan(streaming);
    now += 18;
    telemetry.endFrame();
    now += 1;
    telemetry.beginFrame();
    now += 8;
    telemetry.endFrame();
    now += 1;
    telemetry.beginFrame();
    now += 12;
    telemetry.endFrame();

    expect(telemetry.frameSummary()).toMatchObject({ count: 2, p50Ms: 8, p95Ms: 12, longFrameCount: 1 });
    expect(telemetry.snapshot().droppedFrames).toBe(1);
  });

  it('关联跨 lane Chunk trace、生成 incident 并导出 Chrome Trace', () => {
    let now = 0;
    const telemetry = new PerformanceTelemetry({
      now: () => now,
      incidentThresholdMs: 16,
      eventCapacity: 32,
      frameCapacity: 8,
    });
    const trace = telemetry.beginTrace('chunk-request', 'chunk:0,0,0', 'main');
    now += 3;
    telemetry.markTrace(trace, 'mesh-build', 'worker-derived');
    now += 7;
    telemetry.markTrace(trace, 'mesh-commit', 'main');
    now += 12;
    telemetry.completeTrace(trace, 'chunk-visible', 'main');
    telemetry.recordFrame({ durationMs: 24, topSpans: [{ category: 'mesh-commit', durationMs: 12 }] });

    expect(telemetry.trace(trace)).toMatchObject({ traceId: trace, durationMs: 22, complete: true });
    expect(telemetry.incidents()).toHaveLength(1);
    expect(telemetry.exportChromeTrace().traceEvents).toEqual(
      expect.arrayContaining([expect.objectContaining({ cat: 'chunk-request', tid: 'main' })]),
    );
  });

  it('在记录器失败或满载时只丢弃观测事件，不影响调用者', () => {
    const telemetry = new PerformanceTelemetry({ now: () => 0, eventCapacity: 1, frameCapacity: 1 });

    telemetry.counter('loaded_chunks', 1);
    telemetry.counter('loaded_chunks', 2);

    expect(telemetry.snapshot()).toMatchObject({ droppedEvents: 1, gauges: { loaded_chunks: 2 } });
  });
});
