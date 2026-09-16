import { describe, expect, it } from 'vitest';
import { projectDebugPanel, type DebugPanelInput } from '../../../src/app/ui/debug-diagnostics';
import { PerformanceTelemetry } from '../../../src/client/presentation/performance-telemetry';

const telemetry = new PerformanceTelemetry({ now: () => 0 });
const input: DebugPanelInput = {
  sampledAtMs: 250,
  fps: 60,
  frameMs: 16,
  seed: 'diagnostic-world',
  position: [0, 64, 0],
  quality: 'medium',
  profile: 'desktop',
  device: 'WebGL2',
  worldTime: 8,
  worldRevision: 1,
  generatorVersion: 1,
  performance: {
    scenarioId: 'test',
    frame: telemetry.frameSummary(),
    chunkVisible: telemetry.traceSummary('chunk'),
    completedChunkTraces: 0,
    traceEventCount: 0,
    maxMeshCommitsInFrame: 0,
    maxMeshPartsInFrame: 0,
    visibleAfterPostrender: false,
    incidents: 0,
    droppedEvents: 0,
    uploadQueueDepth: 0,
    estimatedMeshBytes: 1048576,
  },
  chunks: {
    loadedChunks: 1,
    renderedChunks: 1,
    generationQueue: 0,
    meshingQueue: 0,
    deferredRemeshes: 0,
    triangles: 12,
    drawCalls: 1,
  },
};

describe('运行诊断的数据边界', () => {
  it('缺少宿主、帧窗口或平台数据时显示未知，不显示零负载', () => {
    const panel = projectDebugPanel({ ...input, fps: null });
    const metrics = [...panel.highlights, ...panel.groups.flatMap((group) => group.metrics)];
    for (const label of [
      'FPS',
      'Worker',
      '帧 p95',
      '排队任务',
      '世界状态',
      '选择的核',
      '主线程 JS 已用堆',
      'OS 线程数 / CPU 占用率',
    ]) {
      expect(metrics.find((item) => item.label === label)).toMatchObject({ value: '未提供', kind: 'unavailable' });
    }
    expect(metrics.find((item) => item.label === '网格数据估算')).toMatchObject({ value: '1 MiB', kind: 'estimated' });
  });

  it('非有限平台测量不污染面板，堆估算不提升为进程总内存', () => {
    const panel = projectDebugPanel({
      ...input,
      heap: { usedJSHeapSize: NaN, totalJSHeapSize: 2097152, jsHeapSizeLimit: Infinity },
    });
    const metrics = panel.groups.find((group) => group.id === 'memory')!.metrics;
    expect(metrics.find((item) => item.label === '主线程 JS 已用堆')?.kind).toBe('unavailable');
    expect(metrics.find((item) => item.label === '主线程 JS 已分配堆')).toMatchObject({
      value: '2 MiB',
      kind: 'estimated',
    });
    expect(metrics.find((item) => item.label === 'GPU 分配 / 全进程内存')?.kind).toBe('unavailable');
  });
});
