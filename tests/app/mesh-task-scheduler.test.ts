import { describe, expect, it } from 'vitest';
import { PERFORMANCE_PROFILES } from '../../src/client/performance-profile';
import { PerformanceTelemetry } from '../../src/client/performance-telemetry';
import { MeshTaskScheduler, type MeshWorkerPort, type WorkerResult } from '../../src/app/mesh-task-scheduler';

class FakeWorker implements MeshWorkerPort {
  onmessage: ((event: MessageEvent<WorkerResult>) => void) | null = null;
  readonly posts: Array<Record<string, unknown>> = [];
  terminated = false;

  postMessage(message: Record<string, unknown>) {
    this.posts.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(result: WorkerResult) {
    this.onmessage?.({ data: result } as MessageEvent<WorkerResult>);
  }
}

const resultFor = (post: Record<string, unknown>): WorkerResult => ({
  kind: 'mesh-result',
  taskId: post.taskId as number,
  traceId: post.traceId as string,
  epoch: post.epoch as number,
  chunkKey: post.chunkKey as string,
  chunkRevision: post.chunkRevision as number,
  haloRevision: post.haloRevision as string,
  cx: post.cx as number,
  cy: post.cy as number,
  cz: post.cz as number,
  workerMeshingMs: 1,
  meshes: [],
});

const createScheduler = (worker: FakeWorker, accepted: WorkerResult[]) =>
  new MeshTaskScheduler({
    worker,
    profile: PERFORMANCE_PROFILES.benchmark,
    telemetry: new PerformanceTelemetry({ now: () => 1 }),
    variant: 'main-snapshot',
    source: {
      seed: 7,
      prepareMainSnapshot: () => ({
        chunkRevision: 1,
        haloRevision: 'halo-1',
        canonical: new Uint16Array(1),
        halo: new Uint16Array(1),
      }),
      prepareWorkerInput: () => ({
        chunkRevision: 1,
        generatorVersion: 1,
        overlays: [],
      }),
      acceptWorkerCanonical: () => true,
    },
    onAcceptedResult: (_task, result) => accepted.push(result),
  });

describe('MeshTaskScheduler', () => {
  it('accepts only the latest identity after a forced replacement', () => {
    const worker = new FakeWorker();
    const accepted: WorkerResult[] = [];
    const scheduler = createScheduler(worker, accepted);

    scheduler.request(0, 0, 0);
    scheduler.request(0, 0, 0, true);
    const [stalePost] = worker.posts;
    expect(stalePost).toBeDefined();

    worker.emit(resultFor(stalePost!));
    expect(accepted).toHaveLength(0);
    const currentPost = worker.posts[1];
    expect(currentPost).toBeDefined();
    worker.emit(resultFor(currentPost!));
    expect(accepted.map((result) => result.taskId)).toEqual([currentPost!.taskId]);
  });

  it('drops a result that arrives after its chunk was cancelled', () => {
    const worker = new FakeWorker();
    const accepted: WorkerResult[] = [];
    const scheduler = createScheduler(worker, accepted);

    scheduler.request(2, 0, 3);
    const [post] = worker.posts;
    scheduler.cancel('2,0,3');
    worker.emit(resultFor(post!));

    expect(accepted).toHaveLength(0);
    scheduler.dispose();
    expect(worker.terminated).toBe(true);
  });
});
