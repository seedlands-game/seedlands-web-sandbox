import { describe, expect, it } from 'vitest';
import { MeshTaskScheduler, type MeshWorkerPort } from '../../../src/app/world/mesh-task-scheduler';
import type { WorkerResult } from '../../../src/app/app-contracts';
import { PERFORMANCE_PROFILES } from '../../../src/client/presentation/performance-profile';
import { PerformanceTelemetry } from '../../../src/client/presentation/performance-telemetry';
import { testWorldgenProvider } from '../client/fixtures/worldgen-provider';

class FairnessWorker implements MeshWorkerPort {
  onmessage: ((event: MessageEvent<WorkerResult>) => void) | null = null;
  onerror: MeshWorkerPort['onerror'] = null;
  readonly posts: Array<Record<string, unknown>> = [];

  postMessage(message: Record<string, unknown>) {
    this.posts.push(message);
  }
  terminate() {}
  completeCurrent() {
    const post = this.posts.at(-1)!;
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

const createScheduler = (worker: FairnessWorker) =>
  new MeshTaskScheduler({
    worker,
    profile: PERFORMANCE_PROFILES.benchmark,
    telemetry: new PerformanceTelemetry({ now: () => 1 }),
    variant: 'main-snapshot',
    source: {
      provider: testWorldgenProvider,
      seed: 7,
      generatorVersion: 3,
      prepareMainSnapshot: () => ({
        chunkRevision: 1,
        haloRevision: 'halo-1',
        canonical: new Uint16Array(1),
        halo: new Uint16Array(1),
      }),
      prepareWorkerInput: () => ({ chunkRevision: 1, generatorVersion: 3, overlays: [] }),
      acceptWorkerCanonical: () => true,
    },
    onAcceptedResult: () => undefined,
  });

describe('MeshTaskScheduler priority fairness', () => {
  it('旧streaming积压不能整批越过新到达的interactive编辑', () => {
    const worker = new FairnessWorker();
    const scheduler = createScheduler(worker);
    scheduler.request(0, 0, 0);
    for (let index = 100; index < 105; index += 1) scheduler.request(index, 0, 0);
    for (let index = 1; index <= 17; index += 1) scheduler.request(index, 0, 0, { priority: 'interactive-fluid' });

    for (let guard = 0; worker.posts.at(-1)?.chunkKey !== '17,0,0' && guard < 24; guard += 1) worker.completeCurrent();
    expect(worker.posts.at(-1)?.chunkKey).toBe('17,0,0');

    scheduler.request(200, 0, 0, { priority: 'interactive' });
    worker.completeCurrent();
    expect(worker.posts.at(-1)?.chunkKey).toBe('200,0,0');
  });

  it('持续流体重网格时在有界burst后放行一项旧streaming', () => {
    const worker = new FairnessWorker();
    const scheduler = createScheduler(worker);
    scheduler.request(0, 0, 0);
    scheduler.request(99, 0, 0);
    for (let index = 1; index < 40; index += 1) {
      scheduler.request(index, 0, 0, { priority: 'interactive-fluid' });
      worker.completeCurrent();
      if (worker.posts.some((post) => post.chunkKey === '99,0,0')) break;
    }
    const streamingDispatch = worker.posts.findIndex((post) => post.chunkKey === '99,0,0');
    expect(streamingDispatch).toBeGreaterThan(0);
    expect(streamingDispatch).toBeLessThanOrEqual(9);
  });
});
