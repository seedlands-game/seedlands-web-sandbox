import { describe, expect, it, vi } from 'vitest';
import { BrowserComputeRuntime } from '../../src/client/browser-compute-runtime';
import type { ComputeWorkerPort } from '../../src/client/compute-worker-pool';
import type { ComputeLane } from '../../src/runtime/compute-task-queue';

class FakeWorker implements ComputeWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posts: unknown[] = [];
  postMessage(message: unknown) {
    this.posts.push(message);
  }
  terminate() {}
}

describe('BrowserComputeRuntime', () => {
  it('把新世界出生点搜索放入通用计算槽并等待结果', async () => {
    const workers: Array<{ lane: ComputeLane; worker: FakeWorker }> = [];
    const runtime = new BrowserComputeRuntime({
      epoch: 'world:1',
      generalWorkerCount: 1,
      createWorker: (lane) => {
        const worker = new FakeWorker();
        workers.push({ lane, worker });
        return worker;
      },
      onFluidCandidate: () => undefined,
    });

    const finding = runtime.findSafeSpawn(7, 3);
    const general = workers.find(({ lane }) => lane === 'general')!.worker;
    const task = (general.posts[0] as { task: { taskId: number; category: string; payload: unknown } }).task;
    expect(task).toMatchObject({ category: 'chunk-generation', payload: { kind: 'find-safe-spawn' } });
    general.onmessage?.({
      data: {
        kind: 'compute-result',
        protocolVersion: 1,
        epoch: 'world:1',
        taskId: task.taskId,
        ok: true,
        result: { kind: 'safe-spawn-result', position: [0.5, 33, 0.5] },
      },
    } as MessageEvent<unknown>);
    await expect(finding).resolves.toEqual([0.5, 33, 0.5]);
  });

  it('把流体事务固定送保留槽并把Mesh旧端口适配到通用池', () => {
    const workers: Array<{ lane: ComputeLane; worker: FakeWorker }> = [];
    const fluid = vi.fn();
    const runtime = new BrowserComputeRuntime({
      epoch: 'world:1',
      generalWorkerCount: 1,
      createWorker: (lane) => {
        const worker = new FakeWorker();
        workers.push({ lane, worker });
        return worker;
      },
      onFluidCandidate: fluid,
    });
    const mesh = vi.fn();
    runtime.meshPort.onmessage = mesh;
    runtime.meshPort.postMessage(
      {
        kind: 'mesh',
        taskId: 7,
        traceId: 'mesh',
        epoch: 0,
        chunkKey: '0,0,0',
        seed: 1,
        cx: 0,
        cy: 0,
        cz: 0,
        chunkRevision: 2,
        haloRevision: 'halo',
        canonical: new Uint16Array(32 ** 3).buffer,
        halo: new Uint16Array(34 ** 3).buffer,
        fluid: new Uint8Array(32 ** 3).buffer,
        fluidHalo: new Uint8Array(34 ** 3).buffer,
      },
      [],
    );
    runtime.enqueueFluid({
      protocolVersion: 1,
      epoch: 1,
      workId: 'fluid:1',
      frontier: [],
      chunks: [],
    });

    expect(workers.map(({ lane }) => lane)).toEqual(['fluid', 'general']);
    expect((workers[0].worker.posts[0] as { task: { category: string } }).task.category).toBe('fluid');
    expect((workers[1].worker.posts[0] as { task: { category: string } }).task.category).toBe('mesh');
    const generalTask = (workers[1].worker.posts[0] as { task: { taskId: number } }).task;
    workers[1].worker.onmessage?.({
      data: {
        kind: 'compute-result',
        protocolVersion: 1,
        epoch: 'world:1',
        taskId: generalTask.taskId,
        ok: true,
        result: { kind: 'mesh-result', chunkKey: '0,0,0' },
      },
    } as MessageEvent<unknown>);
    expect(mesh).toHaveBeenCalledWith({ data: expect.objectContaining({ taskId: 7 }) });
  });
});
