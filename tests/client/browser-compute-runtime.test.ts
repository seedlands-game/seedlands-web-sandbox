import { describe, expect, it, vi } from 'vitest';
import { BrowserComputeRuntime } from '../../src/client/compute/browser-compute-runtime';
import type { ComputeWorkerPort } from '../../src/client/compute/compute-worker-pool';
import type { ComputeLane } from '../../src/runtime/compute-task-queue';
import { CHUNK_SIZE } from '../../src/world/voxel';

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
        result: {
          kind: 'safe-spawn-result',
          playerBodyPosition: [0.5, 33, 0.5],
          starterChunks: [],
        },
      },
    } as MessageEvent<unknown>);
    await expect(finding).resolves.toEqual({
      kind: 'safe-spawn-result',
      playerBodyPosition: [0.5, 33, 0.5],
      starterChunks: [],
    });
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

  it('合并同一canonical请求并通过通用槽返回纯Chunk结果', async () => {
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

    const first = runtime.generateCanonicalChunk(7, 3, '64,1,0');
    const duplicate = runtime.generateCanonicalChunk(7, 3, '64,1,0');
    expect(duplicate).toBe(first);
    const general = workers.find(({ lane }) => lane === 'general')!.worker;
    const task = (general.posts[0] as { task: { taskId: number; priority: string; payload: unknown } }).task;
    expect(task).toMatchObject({
      priority: 'interaction',
      payload: { kind: 'generate-canonical', key: '64,1,0', cx: 64, cy: 1, cz: 0 },
    });
    const canonical = new Uint16Array(CHUNK_SIZE ** 3);
    general.onmessage?.({
      data: {
        kind: 'compute-result',
        protocolVersion: 1,
        epoch: 'world:1',
        taskId: task.taskId,
        ok: true,
        result: {
          kind: 'canonical-result',
          key: '64,1,0',
          cx: 64,
          cy: 1,
          cz: 0,
          chunkRevision: 0,
          generatorVersion: 3,
          voxels: canonical.buffer,
        },
      },
    } as MessageEvent<unknown>);
    await expect(first).resolves.toMatchObject({ kind: 'canonical-result', key: '64,1,0' });
  });

  it('向旧Mesh端口转发失败与取消回执并保留交互优先级', () => {
    const workers: FakeWorker[] = [];
    const runtime = new BrowserComputeRuntime({
      epoch: 'world:1',
      generalWorkerCount: 1,
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      onFluidCandidate: () => undefined,
    });
    const failure = vi.fn();
    runtime.meshPort.onerror = failure;
    runtime.meshPort.postMessage({ kind: 'mesh', taskId: 7, chunkKey: '0,0,0', priority: 'interactive-fluid' }, []);
    const task = (workers[1].posts[0] as { task: { taskId: number; priority: string } }).task;
    expect(task.priority).toBe('interaction');
    workers[1].onmessage?.({
      data: {
        kind: 'compute-result',
        protocolVersion: 1,
        epoch: 'world:1',
        taskId: task.taskId,
        ok: false,
        error: 'bad mesh',
      },
    } as MessageEvent<unknown>);
    expect(failure).toHaveBeenCalledWith({ taskId: 7, error: expect.any(Error) });
    runtime.meshPort.postMessage({ kind: 'mesh', taskId: 8, chunkKey: '0,0,0' }, []);
    const next = (workers[1].posts[1] as { task: { taskId: number } }).task;
    runtime.meshPort.postMessage({ kind: 'cancel-mesh', taskId: 8 }, []);
    expect(workers[1].posts.at(-1)).toMatchObject({ kind: 'cancel-compute-task', taskId: next.taskId });
    workers[1].onmessage?.({
      data: { kind: 'compute-result', protocolVersion: 1, epoch: 'world:1', taskId: next.taskId, ok: true, result: {} },
    } as MessageEvent<unknown>);
    expect(failure).toHaveBeenCalledWith({ taskId: 8, error: expect.any(Error) });
    runtime.dispose();
  });
});
