import type { AuthoritySnapshot } from '@seedlands/game-core/server/authority/authority-session';
import type { ComputePoolDiagnostics } from '../../client/compute/compute-worker-pool';
import type { HarnessSnapshot, PerformanceSummary } from '../app-contracts';

export type DebugRuntimeInput = Readonly<{
  authority: AuthoritySnapshot | null;
  frequencies: Readonly<{ physicsHz: number; gameplayHz: number; fluidHz: number }> | null;
  compute: ComputePoolDiagnostics | null;
  logic: Readonly<{
    blockStartedCount: number;
    blockCompletedCount: number;
    observationInFlight?: boolean;
    pendingObservationCount?: number;
    submittedObservationCount?: number;
    completedBatchCount?: number;
    lastRoundTripMs?: number | null;
  }> | null;
  authorityReady: boolean;
  logicReady: boolean;
  experiments: HarnessSnapshot['experiments'];
  storageBytes: number | null;
}>;

export type DebugMetric = Readonly<{
  label: string;
  value: string;
  source: string;
  kind: 'measured' | 'configured' | 'estimated' | 'unavailable';
}>;
export type DebugGroup = Readonly<{ id: string; label: string; caption: string; metrics: readonly DebugMetric[] }>;
export type DebugPanel = Readonly<{
  sampledAtMs: number;
  groups: readonly DebugGroup[];
  highlights: readonly DebugMetric[];
}>;

export type DebugPanelInput = Readonly<{
  sampledAtMs: number;
  fps: number | null;
  frameMs: number;
  seed: string;
  position: readonly number[];
  quality: string;
  profile: string;
  device: string;
  worldTime: number;
  worldRevision: number;
  generatorVersion: number;
  performance: PerformanceSummary;
  chunks: Readonly<{
    loadedChunks: number;
    renderedChunks: number;
    generationQueue: number;
    meshingQueue: number;
    deferredRemeshes: number;
    triangles: number;
    drawCalls: number;
  }>;
  runtime?: DebugRuntimeInput;
  heap?: Readonly<{ usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number }> | null;
}>;

const metric = (
  label: string,
  value: number | string | null | undefined,
  source: string,
  unit = '',
  kind: DebugMetric['kind'] = 'measured',
): DebugMetric =>
  value == null || (typeof value === 'number' && !Number.isFinite(value))
    ? { label, value: '未提供', source, kind: 'unavailable' }
    : {
        label,
        value: `${typeof value === 'number' ? Number(value.toFixed(2)).toLocaleString('en-US') : value}${unit}`,
        source,
        kind,
      };
const mib = (bytes: number | null | undefined) => (bytes == null ? null : bytes / 1_048_576);
const ms = (label: string, value: number | null | undefined, source: string) => metric(label, value, source, ' ms');

/** Only formats read-only observations. Missing measurements never become zero usage. */
export function projectDebugPanel(input: DebugPanelInput): DebugPanel {
  const { runtime, chunks, performance: perf } = input;
  const authority = runtime?.authority;
  const compute = runtime?.compute;
  const activity = compute?.workerActivity ?? [];
  const costs = authority?.diagnostics?.physicsCost;
  const residency = authority?.diagnostics?.residency;
  const fluid = authority?.diagnostics?.fluid;
  const workerCount = runtime
    ? Number(runtime.authorityReady) * 2 + Number(runtime.logicReady) + (compute?.workerCount ?? 0)
    : null;
  const highlights = [
    metric('FPS', input.fps, '主线程 · 500 ms 窗口'),
    ms('帧 p95', perf.frame.count ? perf.frame.p95Ms : null, '主线程 · 有界帧窗口'),
    metric('Worker', workerCount, '已创建并连接的 Web Worker，含 Persistence'),
    metric('排队任务', compute?.queued, 'ComputePool 当前队列'),
  ];
  const group = (id: string, label: string, caption: string, metrics: DebugMetric[]): DebugGroup => ({
    id,
    label,
    caption,
    metrics,
  });
  const status = { starting: '启动中', idle: '空闲', busy: '执行中', unavailable: '不可用' } as const;
  return {
    sampledAtMs: input.sampledAtMs,
    highlights,
    groups: [
      group('overview', '概览', '当前帧与世界进度', [
        ms('当前帧', input.frameMs, '主线程帧间隔，非 CPU 使用时间'),
        metric('画质 / 性能档', `${input.quality} / ${input.profile}`, '配置', '', 'configured'),
        metric('世界状态', authority ? (authority.paused ? '暂停' : '运行') : null, 'Authority snapshot'),
        metric('物理 tick', authority?.physicsTick, 'Authority snapshot'),
        metric('提交序列', authority?.commitSequence, 'Authority snapshot'),
        metric('驻留 / 可见 Chunk', `${chunks.loadedChunks} / ${chunks.renderedChunks}`, '客户端派生世界'),
        metric(
          '计算忙碌 / 槽位',
          compute ? `${compute.running} / ${compute.workerCount}` : null,
          'ComputePool，不是 CPU 占用率',
        ),
        metric(
          '已完成 / 失败任务',
          compute ? `${compute.completedTasks} / ${compute.failedTasks}` : null,
          '当前 ComputePool 生命周期',
        ),
        metric('玩家位置', input.position.map((value) => value.toFixed(1)).join(', '), '玩家视角坐标'),
      ]),
      group('world', '世界', 'Authority 是唯一世界写者', [
        metric('Seed', input.seed, '世界身份', '', 'configured'),
        metric('Generator', `v${input.generatorVersion}`, '世界身份', '', 'configured'),
        metric('世界 revision', input.worldRevision, '客户端最近接收的世界 revision'),
        metric('会话 epoch', authority?.epoch, 'Authority snapshot'),
        metric('世界天时', input.worldTime, '天时不等于模拟时间', ' h'),
        metric(
          'Physics / Gameplay / Fluid',
          runtime?.frequencies
            ? `${runtime.frequencies.physicsHz} / ${runtime.frequencies.gameplayHz} / ${runtime.frequencies.fluidHz} Hz`
            : null,
          'Authority 频率配置',
          '',
          'configured',
        ),
        metric('物理 tick', authority?.physicsTick, 'Authority snapshot'),
        ms('已积分物理时间', authority?.integratedPhysicsTimeMs, 'Authority snapshot'),
        ms('物理时间债务', authority?.physicsDebtMs, 'Authority scheduler'),
        metric('确认输入序列', authority?.acknowledgedInputSequence, 'Authority snapshot'),
        metric('提交序列', authority?.commitSequence, 'Authority snapshot'),
        metric('实体身体', authority?.entities.length, 'Authority snapshot'),
        metric(
          '权威 Chunk / 上限',
          residency ? `${residency.residentCount} / ${residency.hardLimit}` : null,
          'Authority residency',
        ),
        metric(
          '脏块 / 固定块',
          residency ? `${residency.dirtyCount} / ${residency.pinnedCount}` : null,
          'Authority residency',
        ),
        metric('自动保存', residency ? (residency.autoSaveInFlight ? '进行中' : '空闲') : null, 'Authority residency'),
        metric('保存失败次数', residency?.autoSaveFailureCount, 'Authority residency'),
      ]),
      group('scheduling', '调度', '任务状态与耗时；不等同于 OS 线程或 CPU 占用', [
        metric(
          'Authority / Persistence',
          runtime ? (runtime.authorityReady ? '1 / 1 · 已连接' : '未就绪') : null,
          'Authority 连接包含持久化 Worker 端口',
        ),
        metric('Logic Worker', runtime ? (runtime.logicReady ? '已就绪' : '未就绪') : null, 'Logic ready 握手'),
        metric(
          'Logic 执行 / 待处理',
          runtime?.logic?.observationInFlight == null
            ? null
            : `${runtime.logic.observationInFlight ? 1 : 0} / ${runtime.logic.pendingObservationCount ?? '—'}`,
          'LogicClient 合并队列',
        ),
        metric(
          'Logic 观察 / 回执',
          runtime?.logic?.submittedObservationCount == null
            ? null
            : `${runtime.logic.submittedObservationCount} / ${runtime.logic.completedBatchCount ?? '—'}`,
          'LogicClient 当前会话',
        ),
        ms('Logic 最近往返', runtime?.logic?.lastRoundTripMs, '主线程→Logic Worker→主线程，包含排队'),
        ms(
          '物理成本 p95',
          costs?.count
            ? [...costs.samplesMs].sort((a, b) => a - b)[Math.max(0, Math.ceil(costs.samplesMs.length * 0.95) - 1)]
            : null,
          'Authority 最近同步物理批次',
        ),
        metric('计算排队 / 峰值', compute ? `${compute.queued} / ${compute.maxQueued}` : null, 'ComputePool'),
        metric('排队数据', mib(compute?.queuedBytes), '任务 estimatedBytes 合计', ' MiB', 'estimated'),
        metric(
          '取消 / 陈旧结果',
          compute ? `${compute.cancellationRequests} / ${compute.staleResults}` : null,
          'ComputePool',
        ),
        metric(
          '流体待处理 / 租约',
          fluid ? `${fluid.pendingCellCount} / ${fluid.inFlightLeaseCount}` : null,
          'Authority fluid',
        ),
        ...activity.flatMap((worker) => [
          metric(
            `${worker.lane} #${worker.index}`,
            `${status[worker.status]}${worker.taskCategory ? ` · ${worker.taskCategory} #${worker.taskId}` : ''}`,
            'ComputePool 当前槽位',
          ),
          ms(
            `${worker.lane} #${worker.index} 最近 / 当前任务年龄`,
            worker.status === 'busy' ? worker.taskAgeMs : worker.lastTaskDurationMs,
            worker.status === 'busy' ? '主线程派发后经过时间' : 'Worker ACK 的最近任务总耗时',
          ),
        ]),
        metric('OS 线程数 / CPU 占用率', null, '浏览器未暴露该测量；hardwareConcurrency 不是使用率'),
      ]),
      group('render', '渲染', 'WebGL2 与 Chunk 网格管线', [
        metric('渲染后端', input.device, 'GraphicsDevice', '', 'configured'),
        metric('Triangles', chunks.triangles, '可见 Chunk 网格'),
        metric('Draw calls', chunks.drawCalls, '渲染遥测'),
        metric('生成 / 网格队列', `${chunks.generationQueue} / ${chunks.meshingQueue}`, '客户端 streaming'),
        metric('延后重建', chunks.deferredRemeshes, '客户端 streaming'),
        metric('上传队列', perf.uploadQueueDepth, '客户端网格提交'),
        metric('单帧最大提交 / 部件', `${perf.maxMeshCommitsInFrame} / ${perf.maxMeshPartsInFrame}`, '当前性能窗口'),
        ms('Chunk 可见 p95', perf.chunkVisible.count ? perf.chunkVisible.p95Ms : null, '请求至可见 trace，包含队列'),
        ms('帧 p50', perf.frame.count ? perf.frame.p50Ms : null, '主线程帧窗口'),
        ms('帧 p99', perf.frame.count ? perf.frame.p99Ms : null, '主线程帧窗口'),
        metric('诊断事件丢弃', perf.droppedEvents, '有界遥测缓冲'),
        metric('GPU 时间 / 占用率', null, '本面板未启用 GPU 查询'),
      ]),
      group('wasm', 'Wasm', '每个 Worker 独立实例；累计值随 Worker 重建归零', [
        metric(
          'Wasm 请求',
          runtime ? (runtime.experiments.requested.wasm ? '启用' : '关闭') : null,
          '启动配置',
          '',
          'configured',
        ),
        metric(
          'SIMD 请求',
          runtime ? (runtime.experiments.requested.simd ? '启用' : '关闭') : null,
          '启动配置',
          '',
          'configured',
        ),
        metric(
          '选择的核',
          runtime ? runtime.experiments.kernels.join(', ') || '无' : null,
          '启动配置',
          '',
          'configured',
        ),
        metric('Wasm 内部线程', '关闭 · 独立线性内存', '当前架构配置', '', 'configured'),
        ...(compute?.workerKernelStates ?? []).flatMap((worker) => {
          const sample = activity.find((slot) => slot.lane === worker.lane && slot.index === worker.index);
          const kernel = sample?.status !== 'unavailable' ? sample?.kernel : null;
          return [
            metric(
              `${worker.lane} #${worker.index} 后端`,
              kernel?.failed ? '运行失败 · TS fallback' : `${worker.effectiveArtifact} · ${worker.status}`,
              worker.reason ?? 'Worker ready 握手',
            ),
            metric(
              `${worker.lane} #${worker.index} 调用 / trap`,
              kernel ? `${kernel.calls} / ${kernel.failures}` : null,
              '最近任务 ACK，非每帧实时采样',
            ),
            ms(
              `${worker.lane} #${worker.index} 累计核耗时`,
              kernel?.durationMs,
              '同步 invoke 边界，包含 FFI，不含布局准备与复制',
            ),
            metric(
              `${worker.lane} #${worker.index} 线性内存`,
              mib(kernel?.memoryBytes),
              '最近任务 ACK 的 memory.buffer.byteLength',
              ' MiB',
            ),
            ms(
              `${worker.lane} #${worker.index} 样本年龄`,
              sample?.sampledAtMs == null ? null : Math.max(0, input.sampledAtMs - sample.sampledAtMs),
              '主线程收到最近任务 ACK 后经过时间',
            ),
          ];
        }),
      ]),
      group('memory', '内存', '分别展示测量范围，不能相加当作进程总内存', [
        metric(
          '主线程 JS 已用堆',
          mib(input.heap?.usedJSHeapSize),
          'performance.memory · 非标准、可能粗粒度',
          ' MiB',
          'estimated',
        ),
        metric(
          '主线程 JS 已分配堆',
          mib(input.heap?.totalJSHeapSize),
          'performance.memory · 不包含所有 Worker',
          ' MiB',
          'estimated',
        ),
        metric('JS 堆上限', mib(input.heap?.jsHeapSizeLimit), 'performance.memory · 浏览器报告', ' MiB', 'estimated'),
        metric('网格数据估算', mib(perf.estimatedMeshBytes), 'CPU 网格统计，不是 GPU 分配量', ' MiB', 'estimated'),
        metric('计算排队数据', mib(compute?.queuedBytes), '任务 estimatedBytes；不是复制字节实测', ' MiB', 'estimated'),
        metric('存储快照大小', mib(runtime?.storageBytes), 'Authority 最近持久化统计，非内存', ' MiB'),
        metric('Worker JS 堆', null, '浏览器未提供跨 Worker 堆统计'),
        metric('GPU 分配 / 全进程内存', null, '浏览器未提供该测量'),
      ]),
    ],
  };
}
