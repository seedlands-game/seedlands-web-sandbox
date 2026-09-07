import { describe, expect, it, vi } from 'vitest';
import type {
  DedicatedComputeExecutor,
  DedicatedComputeTask,
} from '../../src/server/compute/dedicated-compute-contract';
import { runDedicatedComputeTask } from '../../src/server/compute/run-dedicated-compute-task';
import { DedicatedBaselineCaptureCoordinator } from '../../src/server/dedicated/dedicated-baseline-capture';
import { DedicatedServerHost } from '../../src/server/dedicated/dedicated-server-host';
import { MemoryGamePersistence } from '../../src/server/persistence/memory-game-persistence';
import { CHUNK_SIZE } from '../../src/world/voxel';

const compute = (): DedicatedComputeExecutor => ({
  execute: vi.fn(async (task: DedicatedComputeTask) => {
    if (task.kind === 'generate-canonical')
      return {
        kind: 'canonical-result' as const,
        key: task.key,
        cx: task.cx,
        cy: task.cy,
        cz: task.cz,
        generatorVersion: task.generatorVersion,
        chunkRevision: 0 as const,
        voxels: new Uint16Array(CHUNK_SIZE ** 3).buffer,
      };
    return runDedicatedComputeTask(task);
  }),
  close: vi.fn(async () => {}),
  diagnostics: () => ({
    mode: 'inline' as const,
    generation: 0,
    queued: 0,
    queuedBytes: 0,
    running: 0,
    runningBytes: 0,
    completedTasks: 0,
    failedTasks: 0,
    cancelledTasks: 0,
    staleResults: 0,
    childPids: [],
    workerThreadIds: [],
    poolSize: 1,
    liveSlots: 0,
    terminatingSlots: 0,
    health: 'healthy' as const,
    restartCountLastMinute: 0,
    ipcBacklogBytes: 0,
    slotCompletedTasks: [0],
    taskIdHighWatermark: -1,
  }),
});

const create = async (
  executor = compute(),
  limits: { pendingChunks?: number } = {},
  hardLimit = 128,
  persistence = new MemoryGamePersistence(),
) => {
  const host = await DedicatedServerHost.create({
    epoch: 'baseline-capture-test',
    seedText: 'baseline-capture-test',
    initialPlayerBodyPosition: [0.5, 33, 0.5],
    persistence,
    executors: { general: executor, fluid: executor, logic: executor },
    canonicalResidency: { target: 0, hardLimit, evictionBatch: hardLimit },
    limits,
    now: () => 0,
  });
  return { host, executor };
};

describe('DedicatedServerHost baseline capture', () => {
  it('通过真实requestChunk生成并同步复制完整27块，随后释放owner和admission预算', async () => {
    const { host, executor } = await create();
    const capture = host.captureBaseline({ captureId: 0, purpose: 'mesh', key: '40,2,40', minimumRevision: 0 });
    await host.waitForIdle();
    const result = await capture;

    expect(result).toMatchObject({
      status: 'available',
      captureId: 0,
      purpose: 'mesh',
      checkpoint: {
        epoch: host.runtime.snapshot().epoch,
        physicsTick: host.runtime.snapshot().physicsTick,
        commitSequence: host.runtime.snapshot().commitSequence,
        worldRevision: host.runtime.snapshot().worldRevision,
      },
    });
    if (result.status !== 'available') throw new Error('Expected mesh capture to be available.');
    expect(result.entries).toHaveLength(27);
    expect(new Set(result.entries.map((entry) => entry.key))).toHaveProperty('size', 27);
    expect(vi.mocked(executor.execute).mock.calls.filter(([task]) => task.kind === 'generate-canonical')).toHaveLength(
      27,
    );
    expect(host.diagnostics()).toMatchObject({
      pendingBaselineCaptures: 0,
      baselineCaptureOwners: 0,
      reservedCanonicalAdmissions: 0,
    });
    await host.stop();
  });

  it('captureId严格递增且预算不足时在dispatch前整体拒绝', async () => {
    const { host, executor } = await create(compute(), {}, 16);
    const first = await host.captureBaseline({ captureId: 4, purpose: 'mesh', key: '80,2,80', minimumRevision: 0 });
    expect(first).toMatchObject({ status: 'unavailable', reason: 'residency-pressure' });
    expect(vi.mocked(executor.execute).mock.calls.filter(([task]) => task.kind === 'generate-canonical')).toHaveLength(
      0,
    );
    await expect(
      host.captureBaseline({ captureId: 4, purpose: 'collision-resync', key: '80,2,80', minimumRevision: 0 }),
    ).rejects.toThrow(/strictly increasing|captureId/i);
    for (let captureId = 5; captureId <= 261; captureId += 1)
      await expect(
        host.captureBaseline({ captureId, purpose: 'mesh', key: '80,2,80', minimumRevision: 0 }),
      ).resolves.toMatchObject({ status: 'unavailable', reason: 'residency-pressure' });
    await expect(host.cancelBaselineCapture(4)).resolves.toEqual({
      captureId: 4,
      captureGeneration: null,
      status: 'unknown',
    });
    await expect(
      host.captureBaseline({ captureId: 4, purpose: 'collision-resync', key: '80,2,80', minimumRevision: 0 }),
    ).rejects.toThrow(/strictly increasing|captureId/i);
    expect(host.diagnostics().reservedCanonicalAdmissions).toBe(0);
    await host.stop();

    const pendingLimited = await create(compute(), { pendingChunks: 8 });
    await expect(
      pendingLimited.host.captureBaseline({
        captureId: 0,
        purpose: 'mesh',
        key: '90,2,90',
        minimumRevision: 0,
      }),
    ).resolves.toMatchObject({ status: 'unavailable', reason: 'residency-pressure' });
    expect(
      vi.mocked(pendingLimited.executor.execute).mock.calls.filter(([task]) => task.kind === 'generate-canonical'),
    ).toHaveLength(0);
    await pendingLimited.host.stop();
  });

  it('先pin已加载目标再做maintenance，不驱逐并重新生成同一collision基线', async () => {
    const { host, executor } = await create();
    host.runtime.server.getChunk(70, 2, 70);
    const generatedBefore = vi
      .mocked(executor.execute)
      .mock.calls.filter(([task]) => task.kind === 'generate-canonical').length;

    await expect(
      host.captureBaseline({ captureId: 0, purpose: 'collision-resync', key: '70,2,70', minimumRevision: 0 }),
    ).resolves.toMatchObject({ status: 'available' });
    expect(vi.mocked(executor.execute).mock.calls.filter(([task]) => task.kind === 'generate-canonical')).toHaveLength(
      generatedBefore,
    );
    expect(host.diagnostics()).toMatchObject({ baselineCaptureOwners: 0, reservedCanonicalAdmissions: 0 });
    await host.stop();
  });

  it('准备或生成失败使bundle整体不可用，记录诊断并在全部工作结算后释放预算', async () => {
    class RejectingPersistence extends MemoryGamePersistence {
      async ensureSnapshot(cx: number): Promise<void> {
        if (cx === 160) throw new Error('controlled preparation failure');
      }
    }
    const preparation = await create(compute(), {}, 128, new RejectingPersistence());
    await expect(preparation.host.requestChunk('160,2,160')).resolves.toBe(false);
    expect(preparation.host.diagnostics()).toMatchObject({
      failedJobs: 1,
      failure: 'controlled preparation failure',
      pendingChunks: 0,
      reservedCanonicalAdmissions: 0,
    });
    await preparation.host.stop();

    const executor = compute();
    const original = vi.mocked(executor.execute).getMockImplementation()!;
    vi.mocked(executor.execute).mockImplementation(async (task) => {
      if (task.kind === 'generate-canonical' && task.key === '170,2,170')
        throw new Error('controlled generation failure');
      return original(task);
    });
    const generated = await create(executor);
    const capture = generated.host.captureBaseline({
      captureId: 0,
      purpose: 'mesh',
      key: '170,2,170',
      minimumRevision: 0,
    });
    await generated.host.waitForIdle();
    await expect(capture).resolves.toMatchObject({ status: 'unavailable', reason: 'not-available' });
    expect(generated.host.diagnostics()).toMatchObject({
      failedJobs: 1,
      failure: 'controlled generation failure',
      pendingChunks: 0,
      pendingBaselineCaptures: 0,
      reservedCanonicalAdmissions: 0,
    });
    await generated.host.stop();
  });

  it('重叠capture共享同一批生成，取消一个owner不破坏另一个', async () => {
    const executor = compute();
    const original = vi.mocked(executor.execute).getMockImplementation()!;
    let release!: () => void;
    let entered!: () => void;
    let blocked = false;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.mocked(executor.execute).mockImplementation(async (task) => {
      if (task.kind === 'generate-canonical' && !blocked) {
        blocked = true;
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return original(task);
    });
    const { host } = await create(executor);
    const first = host.captureBaseline({ captureId: 0, purpose: 'mesh', key: '120,2,120', minimumRevision: 0 });
    await started;
    const second = host.captureBaseline({ captureId: 1, purpose: 'mesh', key: '120,2,120', minimumRevision: 0 });
    const ordinary = host.requestChunk('120,2,120');
    const cancellation = host.cancelBaselineCapture(0);
    release();
    await host.waitForIdle();

    await expect(first).resolves.toMatchObject({ status: 'unavailable', reason: 'cancelled' });
    await expect(second).resolves.toMatchObject({ status: 'available', captureId: 1 });
    await expect(ordinary).resolves.toBe(true);
    await expect(cancellation).resolves.toMatchObject({ status: 'cancelled', captureGeneration: 0 });
    expect(vi.mocked(executor.execute).mock.calls.filter(([task]) => task.kind === 'generate-canonical')).toHaveLength(
      27,
    );
    expect(host.diagnostics()).toMatchObject({
      pendingBaselineCaptures: 0,
      baselineCaptureOwners: 0,
      reservedCanonicalAdmissions: 0,
    });
    await host.stop();
  });

  it('预先取消不启动生成，完成窗口内的后续cancel返回already-settled', async () => {
    const { host, executor } = await create();
    const controller = new AbortController();
    controller.abort();
    await expect(
      host.captureBaseline(
        { captureId: 0, purpose: 'collision-resync', key: '130,2,130', minimumRevision: 0 },
        controller.signal,
      ),
    ).resolves.toMatchObject({ status: 'unavailable', reason: 'cancelled' });
    await expect(host.cancelBaselineCapture(0)).resolves.toEqual({
      captureId: 0,
      captureGeneration: 0,
      status: 'already-settled',
    });
    expect(vi.mocked(executor.execute).mock.calls.filter(([task]) => task.kind === 'generate-canonical')).toHaveLength(
      0,
    );
    await host.stop();
  });

  it('启动请求同步失败时仍等待此前已接纳请求结算后再释放retention', async () => {
    let releaseStarted!: () => void;
    let retentionReleased = false;
    let requestCount = 0;
    const coordinator = new DedicatedBaselineCaptureCoordinator({
      isRunning: () => true,
      hasLoaded: () => false,
      reserve: () => ({ claim: () => true, releaseUnused: () => {} }),
      retain: () => () => {
        retentionReleased = true;
      },
      requestChunk: () => {
        requestCount += 1;
        if (requestCount === 1)
          return new Promise<boolean>((resolve) => {
            releaseStarted = () => resolve(true);
          });
        throw new Error('controlled synchronous request failure');
      },
      copy: () => {
        throw new Error('copy must not run');
      },
    });
    const capture = coordinator.capture({ captureId: 0, purpose: 'mesh', key: '0,0,0', minimumRevision: 0 });
    expect(requestCount).toBe(2);
    expect(retentionReleased).toBe(false);
    releaseStarted();
    await expect(capture).rejects.toThrow('controlled synchronous request failure');
    expect(retentionReleased).toBe(true);
    expect(coordinator.diagnostics()).toMatchObject({ pendingBaselineCaptures: 0, baselineCaptureOwners: 0 });
  });

  it('取消等待已接纳生成物理结算，且stop拒绝新capture并清空资源', async () => {
    const executor = compute();
    const original = vi.mocked(executor.execute).getMockImplementation()!;
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.mocked(executor.execute).mockImplementation(async (task) => {
      if (task.kind === 'generate-canonical') {
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return original(task);
    });
    const { host } = await create(executor);
    const mutableRequest = {
      captureId: 0,
      purpose: 'collision-resync',
      key: '100,2,100',
      minimumRevision: 0,
    } as { captureId: number; purpose: 'mesh' | 'collision-resync'; key: string; minimumRevision: number };
    const capture = host.captureBaseline(mutableRequest);
    await started;
    Object.assign(mutableRequest, { captureId: 99, purpose: 'mesh', key: 'changed' });
    let cancelled = false;
    const cancellation = host.cancelBaselineCapture(0).then((result) => {
      cancelled = true;
      return result;
    });
    await Promise.resolve();
    expect(cancelled).toBe(false);
    release();
    await host.waitForIdle();
    await expect(capture).resolves.toMatchObject({
      status: 'unavailable',
      captureId: 0,
      purpose: 'collision-resync',
      key: '100,2,100',
      reason: 'cancelled',
    });
    await expect(cancellation).resolves.toMatchObject({ captureId: 0, status: 'cancelled' });

    const stopping = host.stop();
    await expect(
      host.captureBaseline({ captureId: 1, purpose: 'collision-resync', key: '101,2,100', minimumRevision: 0 }),
    ).resolves.toMatchObject({ status: 'unavailable', reason: 'stopping' });
    await stopping;
    expect(host.diagnostics()).toMatchObject({
      pendingBaselineCaptures: 0,
      baselineCaptureOwners: 0,
      reservedCanonicalAdmissions: 0,
    });
  });

  it('stop取消capture但等待已接纳生成和retention物理清理', async () => {
    const executor = compute();
    const original = vi.mocked(executor.execute).getMockImplementation()!;
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.mocked(executor.execute).mockImplementation(async (task) => {
      if (task.kind === 'generate-canonical') {
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return original(task);
    });
    const { host } = await create(executor);
    const capture = host.captureBaseline({
      captureId: 0,
      purpose: 'collision-resync',
      key: '140,2,140',
      minimumRevision: 0,
    });
    await started;
    let stopped = false;
    const stopping = host.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;

    await expect(capture).resolves.toMatchObject({ status: 'unavailable', reason: 'cancelled' });
    expect(host.state).toBe('stopped');
    expect(host.diagnostics()).toMatchObject({
      pendingBaselineCaptures: 0,
      baselineCaptureOwners: 0,
      reservedCanonicalAdmissions: 0,
    });
  });
});
