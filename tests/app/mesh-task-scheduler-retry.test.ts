import { describe, expect, it, vi } from 'vitest';
import {
  MeshTaskScheduler,
  type MeshWorkerPort,
  type WorkerResult,
} from '../../apps/web/src/app/world/mesh-task-scheduler';
import { PERFORMANCE_PROFILES } from '../../apps/web/src/client/presentation/performance-profile';
import { PerformanceTelemetry } from '../../apps/web/src/client/presentation/performance-telemetry';

class RetryWorker implements MeshWorkerPort {
  onmessage: ((event: MessageEvent<WorkerResult>) => void) | null = null;
  onerror: MeshWorkerPort['onerror'] = null;
  readonly posts: Array<Record<string, unknown>> = [];

  postMessage(message: Record<string, unknown>) {
    this.posts.push(message);
  }

  terminate() {}

  emit(post: Record<string, unknown>) {
    this.onmessage?.({
      data: {
        kind: 'mesh-result',
        taskId: post.taskId,
        traceId: post.traceId,
        epoch: post.epoch,
        chunkKey: post.chunkKey,
        chunkRevision: post.chunkRevision,
        haloRevision: post.haloRevision,
        cx: post.cx,
        cy: post.cy,
        cz: post.cz,
        workerMeshingMs: 1,
        meshes: [],
      } as WorkerResult,
    } as MessageEvent<WorkerResult>);
  }
}

describe('MeshTaskScheduler preparation retry', () => {
  it('准备背压失败后显式重试保留流体优先级与首见屏障且不紧循环', async () => {
    const worker = new RetryWorker();
    const accepted: Array<Parameters<MeshTaskScheduler['completeVisible']>[0]> = [];
    const beforePrepare = vi.fn().mockRejectedValueOnce(new Error('canonical pressure')).mockResolvedValue(undefined);
    const scheduler = new MeshTaskScheduler({
      worker,
      profile: PERFORMANCE_PROFILES.benchmark,
      telemetry: new PerformanceTelemetry({ now: () => 1 }),
      variant: 'main-snapshot',
      source: {
        beforePrepare,
        releasePrepared: vi.fn(),
        seed: 7,
        generatorVersion: 3,
        prepareMainSnapshot: () => ({
          chunkRevision: 2,
          haloRevision: 'halo-2',
          canonical: new Uint16Array(1),
          halo: new Uint16Array(1),
        }),
        prepareWorkerInput: () => ({ chunkRevision: 2, generatorVersion: 3, overlays: [] }),
        acceptWorkerCanonical: () => true,
      },
      onAcceptedResult: (task) => accepted.push(task),
    });
    scheduler.protectVisibleRevision('0,0,0', 2);
    scheduler.request(0, 0, 0, { forceRemesh: true, priority: 'interactive-fluid' });
    await vi.waitFor(() => expect(beforePrepare).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    expect(worker.posts).toEqual([]);
    expect(scheduler.generationQueueSize).toBe(1);
    scheduler.retryFailedPreparations();
    await vi.waitFor(() => expect(worker.posts).toHaveLength(1));

    expect(beforePrepare).toHaveBeenCalledTimes(2);
    expect(worker.posts[0]).toMatchObject({ priority: 'interactive-fluid' });
    worker.emit(worker.posts[0]!);
    await vi.waitFor(() => expect(accepted).toHaveLength(1));
    expect(accepted[0]).toMatchObject({ visibilityBarrierRevision: 2 });
  });
});
