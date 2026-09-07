import { describe, expect, it, vi } from 'vitest';
import { MeshTaskScheduler, type MeshWorkerPort } from '../../../src/app/world/mesh-task-scheduler';
import type { WorkerResult } from '../../../src/app/app-contracts';
import { PERFORMANCE_PROFILES } from '../../../src/client/presentation/performance-profile';
import { PerformanceTelemetry } from '../../../src/client/presentation/performance-telemetry';
import { runWorldComputeTask, type GenerateMeshTaskPayload } from '../../../src/worker/world-compute-task';

class HeldMeshWorker implements MeshWorkerPort {
  onmessage: MeshWorkerPort['onmessage'] = null;
  onerror: MeshWorkerPort['onerror'] = null;
  readonly tasks: Array<GenerateMeshTaskPayload & { taskId: number }> = [];
  readonly cancelled: number[] = [];
  terminated = false;
  failPost = false;

  postMessage(message: Record<string, unknown>, transfers: Transferable[]) {
    if (message.kind === 'cancel-mesh') {
      this.cancelled.push(message.taskId as number);
      return;
    }
    if (this.failPost) throw new Error('injected pre-admission post failure');
    this.tasks.push(structuredClone(message, { transfer: transfers }) as GenerateMeshTaskPayload & { taskId: number });
  }

  terminate() {
    this.terminated = true;
  }

  async finish(index: number) {
    const task = this.tasks[index]!;
    const result = await runWorldComputeTask(task);
    if (result.kind !== 'mesh-result') throw new Error('Expected actual mesh result.');
    if (!('canonical' in result) || !(result.canonical instanceof ArrayBuffer))
      throw new Error('Complete worker result must own an ArrayBuffer canonical.');
    const message: WorkerResult = { ...result, canonical: result.canonical, taskId: task.taskId };
    this.onmessage?.({ data: message } as MessageEvent<WorkerResult>);
    return message;
  }
}

function completeInput() {
  const overlays: Array<{ cx: number; cy: number; cz: number; voxels: Uint16Array; fluid: Uint8Array }> = [];
  for (let cy = -1; cy <= 1; cy++)
    for (let cz = -1; cz <= 1; cz++)
      for (let cx = -1; cx <= 1; cx++)
        if (cx !== 0 || cy !== 0 || cz !== 0)
          overlays.push({ cx, cy, cz, voxels: new Uint16Array(32 ** 3), fluid: new Uint8Array(32 ** 3) });
  return {
    inputStrategy: 'authority-complete' as const,
    chunkRevision: 1,
    generatorVersion: 3,
    haloRevision: 'scheduler-test:complete-owned-vector',
    canonical: new Uint16Array(32 ** 3),
    fluid: new Uint8Array(32 ** 3),
    overlays,
  };
}

function fixture() {
  const worker = new HeldMeshWorker();
  const settlements: Array<ReturnType<typeof vi.fn>> = [];
  const accepted = vi.fn();
  const acceptDerivedMesh = vi.fn((): boolean | Promise<boolean> => true);
  const prepareCompleteWorkerInput = vi.fn(() => {
    const settle = vi.fn();
    settlements.push(settle);
    return { input: completeInput(), settle };
  });
  const source = {
    kind: 'authority-complete' as const,
    seed: 7,
    generatorVersion: 3,
    prepareCompleteWorkerInput,
    acceptDerivedMesh,
  };
  const scheduler = new MeshTaskScheduler({
    worker,
    source,
    profile: PERFORMANCE_PROFILES.benchmark,
    telemetry: new PerformanceTelemetry({ now: () => 1 }),
    variant: 'worker-first',
    onAcceptedResult: accepted,
  });
  return { worker, scheduler, source, accepted, settlements, acceptDerivedMesh };
}

describe('完整基线调度与输入 lease', () => {
  it('真实 worker 返回完整身份且只调用派生结果接纳，结算一次', async () => {
    const state = fixture();
    try {
      state.scheduler.request(0, 0, 0);
      expect(state.worker.tasks).toHaveLength(1);
      const result = await state.worker.finish(0);
      await vi.waitFor(() => expect(state.accepted).toHaveBeenCalledTimes(1));
      expect(result.haloRevision).toBe('scheduler-test:complete-owned-vector');
      expect(state.acceptDerivedMesh).toHaveBeenCalledTimes(1);
      expect('acceptWorkerCanonical' in state.source).toBe(false);
      expect(state.settlements[0]).toHaveBeenCalledTimes(1);
      state.worker.onmessage?.({ data: result } as MessageEvent<WorkerResult>);
      expect(state.settlements[0]).toHaveBeenCalledTimes(1);
    } finally {
      state.scheduler.dispose();
    }
  });

  it('运行中取消保留旧 task lease 到真实计算结束，重复回包不释放新 task', async () => {
    const state = fixture();
    try {
      state.scheduler.request(0, 0, 0);
      expect(state.worker.tasks).toHaveLength(1);
      state.scheduler.cancel('0,0,0');
      expect(state.worker.cancelled).toHaveLength(1);
      expect(state.settlements[0]).not.toHaveBeenCalled();
      const oldResult = await state.worker.finish(0);
      expect(state.accepted).not.toHaveBeenCalled();
      expect(state.settlements[0]).toHaveBeenCalledTimes(1);
      state.scheduler.request(0, 0, 0);
      expect(state.worker.tasks).toHaveLength(2);
      state.worker.onmessage?.({ data: oldResult } as MessageEvent<WorkerResult>);
      expect(state.settlements[1]).not.toHaveBeenCalled();
      await state.worker.finish(1);
      await vi.waitFor(() => expect(state.settlements[1]).toHaveBeenCalledTimes(1));
    } finally {
      state.scheduler.dispose();
    }
  });

  it('post 失败清理唯一 lease；dispose 在终止 port 后结算活跃输入', () => {
    const state = fixture();
    try {
      state.worker.failPost = true;
      state.scheduler.request(0, 0, 0);
      expect(state.settlements).toHaveLength(1);
      expect(state.settlements[0]).toHaveBeenCalledTimes(1);
      state.worker.failPost = false;
      state.scheduler.request(0, 0, 0);
      expect(state.settlements).toHaveLength(2);
      state.settlements[1]!.mockImplementation(() => expect(state.worker.terminated).toBe(true));
      state.scheduler.dispose();
      expect(state.settlements[1]).toHaveBeenCalledTimes(1);
      state.scheduler.dispose();
      expect(state.settlements[1]).toHaveBeenCalledTimes(1);
    } finally {
      state.scheduler.dispose();
    }
  });

  it('异步派生接纳期间取消后，不能发布已失效结果', async () => {
    const state = fixture();
    let release!: (accepted: boolean) => void;
    state.acceptDerivedMesh.mockImplementation(() => new Promise<boolean>((resolve) => (release = resolve)));
    try {
      state.scheduler.request(0, 0, 0);
      expect(state.worker.tasks).toHaveLength(1);
      await state.worker.finish(0);
      expect(state.acceptDerivedMesh).toHaveBeenCalledTimes(1);
      state.scheduler.cancel('0,0,0');
      expect(state.settlements[0]).not.toHaveBeenCalled();
      release(true);
      await vi.waitFor(() => expect(state.settlements[0]).toHaveBeenCalledTimes(1));
      expect(state.accepted).not.toHaveBeenCalled();
    } finally {
      state.scheduler.dispose();
    }
  });

  it('场景代次变化保留活跃 task lease 到旧结果结束，禁止旧结果接纳', async () => {
    const state = fixture();
    try {
      state.scheduler.request(0, 0, 0);
      expect(state.worker.tasks).toHaveLength(1);
      state.scheduler.beginScenario();
      expect(state.settlements[0]).not.toHaveBeenCalled();
      await state.worker.finish(0);
      expect(state.settlements[0]).toHaveBeenCalledTimes(1);
      expect(state.accepted).not.toHaveBeenCalled();
    } finally {
      state.scheduler.dispose();
    }
  });

  it('完整 source 不允许切到 main-snapshot 旁路', () => {
    const state = fixture();
    try {
      expect(() => state.scheduler.setVariant('main-snapshot')).toThrow();
    } finally {
      state.scheduler.dispose();
    }
  });
});
