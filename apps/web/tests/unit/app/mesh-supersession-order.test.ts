import { describe, expect, it, vi } from 'vitest';
import { MeshTaskScheduler, type MeshWorkerPort, type WorkerResult } from '../../../src/app/world/mesh-task-scheduler';
import { PERFORMANCE_PROFILES } from '../../../src/client/presentation/performance-profile';
import { PerformanceTelemetry } from '../../../src/client/presentation/performance-telemetry';
import { testWorldgenProvider } from '../client/fixtures/worldgen-provider';

class SupersessionWorker implements MeshWorkerPort {
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

describe('MeshTaskScheduler supersession order', () => {
  it('两槽同key后继只在旧准备租约释放后开始新准备', async () => {
    const worker = new SupersessionWorker();
    const events: string[] = [];
    const telemetry = new PerformanceTelemetry({ now: () => 1 });
    let leaseActive = false;
    let revision = 1;
    const scheduler = new MeshTaskScheduler({
      worker,
      profile: { ...PERFORMANCE_PROFILES.benchmark, maxWorkerTasksInFlight: 2 },
      telemetry,
      variant: 'main-snapshot',
      source: {
        provider: testWorldgenProvider,
        beforePrepare: async () => {
          events.push(`prepare-${revision}`);
          leaseActive = true;
          await Promise.resolve();
          if (!leaseActive) throw new Error('Persistence neighborhood load was canceled for 0,0,0.');
        },
        releasePrepared: () => {
          events.push('release');
          leaseActive = false;
        },
        seed: 7,
        generatorVersion: 3,
        prepareMainSnapshot: () => ({
          chunkRevision: revision,
          haloRevision: `halo-${revision}`,
          canonical: new Uint16Array(1),
          halo: new Uint16Array(1),
        }),
        prepareWorkerInput: () => ({ chunkRevision: revision, generatorVersion: 3, overlays: [] }),
        acceptWorkerCanonical: () => true,
      },
      onAcceptedResult: vi.fn(),
    });

    scheduler.request(0, 0, 0);
    await vi.waitFor(() => expect(worker.posts).toHaveLength(1));
    revision = 2;
    scheduler.request(0, 0, 0, { forceRemesh: true, priority: 'interactive-fluid' });
    events.length = 0;
    worker.emit(worker.posts[0]!);
    await vi.waitFor(() => expect(worker.posts).toHaveLength(2));

    expect(events.slice(0, 2)).toEqual(['release', 'prepare-2']);
    expect(events.filter((event) => event === 'prepare-2')).toHaveLength(1);
    expect(telemetry.exportChromeTrace().traceEvents.map(({ name }) => name)).not.toContain('MeshPreparationFailure');
    expect(telemetry.exportChromeTrace().traceEvents.map(({ name }) => name)).not.toContain('persistence-load-error');
  });
});
