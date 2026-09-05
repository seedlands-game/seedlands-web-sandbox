import { describe, expect, it, vi } from 'vitest';
import { PERFORMANCE_PROFILES } from '../../src/client/performance-profile';
import { PerformanceTelemetry } from '../../src/client/performance-telemetry';
import { MeshTaskScheduler, type MeshWorkerPort, type WorkerResult } from '../../src/app/mesh-task-scheduler';

class FakeWorker implements MeshWorkerPort {
  onmessage: ((event: MessageEvent<WorkerResult>) => void) | null = null;
  onerror: MeshWorkerPort['onerror'] = null;
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

const createScheduler = (worker: FakeWorker, accepted: WorkerResult[], releasePrepared = vi.fn()) =>
  new MeshTaskScheduler({
    worker,
    profile: PERFORMANCE_PROFILES.benchmark,
    telemetry: new PerformanceTelemetry({ now: () => 1 }),
    variant: 'main-snapshot',
    source: {
      releasePrepared,
      seed: 7,
      generatorVersion: 3,
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
  it('等待Authority异步接纳canonical后才发布网格', async () => {
    const worker = new FakeWorker();
    const accepted: WorkerResult[] = [];
    let releaseAcceptance!: (accepted: boolean) => void;
    const scheduler = new MeshTaskScheduler({
      worker,
      profile: PERFORMANCE_PROFILES.benchmark,
      telemetry: new PerformanceTelemetry({ now: () => 1 }),
      variant: 'worker-first',
      source: {
        seed: 7,
        generatorVersion: 3,
        prepareMainSnapshot: () => ({
          chunkRevision: 0,
          haloRevision: 'unused',
          canonical: new Uint16Array(1),
          halo: new Uint16Array(1),
        }),
        prepareWorkerInput: () => ({ chunkRevision: 0, generatorVersion: 3, overlays: [] }),
        acceptWorkerCanonical: () => new Promise((resolve) => (releaseAcceptance = resolve)),
      },
      onAcceptedResult: (_task, result) => accepted.push(result),
    });
    scheduler.request(0, 0, 0);
    const post = worker.posts[0]!;
    worker.emit({ ...resultFor(post), canonical: new Uint16Array(32 ** 3).buffer, generatorVersion: 3 });
    await Promise.resolve();
    expect(accepted).toEqual([]);
    releaseAcceptance(true);
    await vi.waitFor(() => expect(accepted).toHaveLength(1));
  });

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

  it('优先派发近场流体替换并把同 key 连续修订合并为最新一次', () => {
    const worker = new FakeWorker();
    const accepted: WorkerResult[] = [];
    let revision = 1;
    const scheduler = new MeshTaskScheduler({
      worker,
      profile: PERFORMANCE_PROFILES.benchmark,
      telemetry: new PerformanceTelemetry({ now: () => 1 }),
      variant: 'main-snapshot',
      source: {
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
      onAcceptedResult: (_task, result) => accepted.push(result),
    });

    scheduler.request(8, 0, 8);
    scheduler.request(7, 0, 7);
    for (revision = 2; revision <= 11; revision += 1)
      scheduler.request(0, 0, 0, { forceRemesh: true, priority: 'interactive-fluid' });
    revision = 11;

    const first = worker.posts[0]!;
    worker.emit(resultFor(first));
    expect(worker.posts[1]?.chunkKey).toBe('0,0,0');
    expect(worker.posts[1]?.chunkRevision).toBe(11);
    worker.emit(resultFor(worker.posts[1]!));
    expect(accepted.map((result) => result.chunkKey)).toContain('0,0,0');

    worker.emit(resultFor(worker.posts[2]!));
    expect(worker.posts.map((post) => post.chunkKey)).toContain('7,0,7');
  });
  it('失败回执释放执行槽，迟到重复结果不能占用或释放下一任务的槽', () => {
    const worker = new FakeWorker();
    const accepted: WorkerResult[] = [];
    const scheduler = createScheduler(worker, accepted);
    scheduler.request(1, 0, 0);
    scheduler.request(2, 0, 0);
    scheduler.request(3, 0, 0);
    const failed = worker.posts[0]!;
    worker.onerror?.({ taskId: failed.taskId as number, error: new Error('worker failed') });
    expect(worker.posts).toHaveLength(2);
    worker.emit(resultFor(failed));
    expect(worker.posts).toHaveLength(2);
    expect(scheduler.meshingQueueSize).toBe(1);
    worker.emit(resultFor(worker.posts[1]!));
    expect(worker.posts).toHaveLength(3);
  });

  it('持续流体重网格不能让旧streaming请求永久排队', () => {
    const worker = new FakeWorker();
    const scheduler = createScheduler(worker, []);
    scheduler.request(0, 0, 0);
    scheduler.request(99, 0, 0);
    for (let index = 1; index < 40; index += 1) {
      scheduler.request(index, 0, 0, { priority: 'interactive-fluid' });
      worker.emit(resultFor(worker.posts.at(-1)!));
      if (worker.posts.some((post) => post.chunkKey === '99,0,0')) break;
    }
    expect(worker.posts.some((post) => post.chunkKey === '99,0,0')).toBe(true);
  });
  it('成功失败关闭都只释放一次准备租约，重复回执不重复释放', () => {
    const worker = new FakeWorker();
    const release = vi.fn();
    const scheduler = createScheduler(worker, [], release);
    scheduler.request(1, 0, 0);
    const first = worker.posts[0]!;
    worker.emit(resultFor(first));
    worker.emit(resultFor(first));
    expect(release).toHaveBeenCalledTimes(1);
    scheduler.request(2, 0, 0);
    worker.onerror?.({ taskId: worker.posts[1]!.taskId as number, error: new Error('failed') });
    expect(release).toHaveBeenCalledTimes(2);
    scheduler.request(3, 0, 0);
    scheduler.dispose();
    expect(release).toHaveBeenCalledTimes(3);
  });
});
