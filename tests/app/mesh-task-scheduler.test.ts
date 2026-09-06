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

  it('首个derived-fluid revision先真实可见，再派发连续流体合并后的唯一最新后继', () => {
    const worker = new FakeWorker();
    const accepted: Array<{
      task: Parameters<MeshTaskScheduler['completeVisible']>[0];
      result: WorkerResult;
    }> = [];
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
      onAcceptedResult: (task, result) => accepted.push({ task, result }),
    });

    scheduler.request(0, 0, 0);
    scheduler.protectVisibleRevision('0,0,0', 2);
    revision = 2;
    scheduler.request(0, 0, 0, { forceRemesh: true, priority: 'interactive-fluid' });
    revision = 3;
    scheduler.protectVisibleRevision('0,0,0', 3);
    scheduler.request(0, 0, 0, { forceRemesh: true, priority: 'interactive-fluid' });

    worker.emit(resultFor(worker.posts[0]!));
    expect(worker.posts).toHaveLength(2);
    expect(worker.posts[1]?.chunkRevision).toBe(3);

    revision = 4;
    scheduler.protectVisibleRevision('0,0,0', 4);
    scheduler.request(0, 0, 0, { forceRemesh: true, priority: 'interactive-fluid' });
    worker.emit(resultFor(worker.posts[1]!));
    expect(accepted.map(({ task }) => task.chunkRevision)).toEqual([3]);
    expect(worker.posts).toHaveLength(2);

    scheduler.completeVisible(accepted[0]!.task);
    expect(worker.posts).toHaveLength(3);
    expect(worker.posts[2]?.chunkRevision).toBe(4);
    expect(scheduler.latestTask('0,0,0')?.visibilityBarrierRevision).toBe(4);
  });

  it('异步准备期间的连续流体修订不能重启准备并饿死Worker', async () => {
    const worker = new FakeWorker();
    const accepted: Array<{
      task: Parameters<MeshTaskScheduler['completeVisible']>[0];
      result: WorkerResult;
    }> = [];
    const prepareResolvers: Array<() => void> = [];
    const beforePrepare = vi.fn(() => new Promise<void>((resolve) => prepareResolvers.push(resolve)));
    let revision = 1;
    const scheduler = new MeshTaskScheduler({
      worker,
      profile: PERFORMANCE_PROFILES.benchmark,
      telemetry: new PerformanceTelemetry({ now: () => 1 }),
      variant: 'main-snapshot',
      source: {
        beforePrepare,
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
      onAcceptedResult: (task, result) => accepted.push({ task, result }),
    });

    scheduler.protectVisibleRevision('0,0,0', revision);
    scheduler.request(0, 0, 0, { priority: 'interactive-fluid' });
    expect(beforePrepare).toHaveBeenCalledTimes(1);
    expect(scheduler.generationQueueSize).toBe(1);
    for (revision = 2; revision <= 121; revision += 1) {
      scheduler.protectVisibleRevision('0,0,0', revision);
      scheduler.request(0, 0, 0, { forceRemesh: true, priority: 'interactive-fluid' });
    }
    revision = 121;

    prepareResolvers[0]!();
    await Promise.resolve();
    await Promise.resolve();

    expect(beforePrepare).toHaveBeenCalledTimes(1);
    expect(scheduler.generationQueueSize).toBe(0);
    expect(worker.posts).toHaveLength(1);
    expect(worker.posts[0]?.chunkRevision).toBe(121);
    worker.emit(resultFor(worker.posts[0]!));
    await vi.waitFor(() => expect(accepted).toHaveLength(1));
    scheduler.completeVisible(accepted[0]!.task);
    expect(beforePrepare).toHaveBeenCalledTimes(1);
  });

  it('取消首见屏障会丢弃延后后继并允许同key新代际重新请求', () => {
    const worker = new FakeWorker();
    const accepted: Array<{ task: Parameters<MeshTaskScheduler['completeVisible']>[0]; result: WorkerResult }> = [];
    let revision = 2;
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
      onAcceptedResult: (task, result) => accepted.push({ task, result }),
    });

    scheduler.protectVisibleRevision('0,0,0', 2);
    scheduler.request(0, 0, 0, { priority: 'interactive' });
    worker.emit(resultFor(worker.posts[0]!));
    revision = 3;
    scheduler.request(0, 0, 0, { forceRemesh: true, priority: 'interactive-fluid' });
    scheduler.cancel('0,0,0');
    scheduler.request(0, 0, 0);

    const meshPosts = worker.posts.filter((post) => post.kind === 'mesh');
    expect(meshPosts).toHaveLength(2);
    expect(meshPosts[1]?.chunkRevision).toBe(3);
  });

  it('场景epoch切换清除首见屏障和旧后继', () => {
    const worker = new FakeWorker();
    const accepted: Parameters<MeshTaskScheduler['completeVisible']>[0][] = [];
    let revision = 2;
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
      onAcceptedResult: (task) => accepted.push(task),
    });

    scheduler.protectVisibleRevision('0,0,0', 2);
    scheduler.request(0, 0, 0, { priority: 'interactive' });
    worker.emit(resultFor(worker.posts[0]!));
    revision = 3;
    scheduler.request(0, 0, 0, { forceRemesh: true, priority: 'interactive-fluid' });
    scheduler.beginScenario();
    scheduler.request(0, 0, 0);

    expect(worker.posts).toHaveLength(2);
    expect(worker.posts[1]?.chunkRevision).toBe(3);
    expect(scheduler.latestTask('0,0,0')?.visibilityBarrierRevision).toBeUndefined();
    scheduler.completeVisible(accepted[0]!);
    expect(worker.posts).toHaveLength(2);
  });

  it('取消异步准备中的请求后旧准备不会复活且新代际可继续', async () => {
    const worker = new FakeWorker();
    const prepareResolvers: Array<() => void> = [];
    const releasePrepared = vi.fn();
    let revision = 1;
    const scheduler = new MeshTaskScheduler({
      worker,
      profile: PERFORMANCE_PROFILES.benchmark,
      telemetry: new PerformanceTelemetry({ now: () => 1 }),
      variant: 'main-snapshot',
      source: {
        beforePrepare: () => new Promise<void>((resolve) => prepareResolvers.push(resolve)),
        releasePrepared,
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
    scheduler.cancel('0,0,0');
    revision = 2;
    scheduler.request(0, 0, 0);
    prepareResolvers[0]!();
    await vi.waitFor(() => expect(prepareResolvers).toHaveLength(2));
    expect(worker.posts).toHaveLength(0);
    expect(releasePrepared).toHaveBeenCalledTimes(1);

    prepareResolvers[1]!();
    await vi.waitFor(() => expect(worker.posts).toHaveLength(1));
    expect(worker.posts[0]?.chunkRevision).toBe(2);
  });

  it.each(['cancel', 'scenario-reset'] as const)('%s后旧异步准备失败不会清掉同key新代际', async (action) => {
    const worker = new FakeWorker();
    const preparations: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
    let revision = 1;
    const scheduler = new MeshTaskScheduler({
      worker,
      profile: PERFORMANCE_PROFILES.benchmark,
      telemetry: new PerformanceTelemetry({ now: () => 1 }),
      variant: 'main-snapshot',
      source: {
        beforePrepare: () => new Promise<void>((resolve, reject) => preparations.push({ resolve, reject })),
        releasePrepared: vi.fn(),
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
    if (action === 'cancel') scheduler.cancel('0,0,0');
    else scheduler.beginScenario();
    revision = 2;
    scheduler.request(0, 0, 0);
    preparations[0]!.reject(new Error('old preparation failed'));
    await vi.waitFor(() => expect(preparations).toHaveLength(2));
    expect(worker.posts).toHaveLength(0);

    preparations[1]!.resolve();
    await vi.waitFor(() => expect(worker.posts).toHaveLength(1));
    expect(worker.posts[0]?.chunkRevision).toBe(2);
  });

  it('屏障任务开始后的下一次流体revision保留一个后继屏障且完成后不残留', () => {
    const worker = new FakeWorker();
    const accepted: Parameters<MeshTaskScheduler['completeVisible']>[0][] = [];
    let revision = 2;
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
      onAcceptedResult: (task) => accepted.push(task),
    });

    scheduler.protectVisibleRevision('0,0,0', 2);
    scheduler.request(0, 0, 0, { priority: 'interactive' });
    scheduler.protectVisibleRevision('0,0,0', 3);
    revision = 3;
    scheduler.request(0, 0, 0, { forceRemesh: true, priority: 'interactive' });
    worker.emit(resultFor(worker.posts[0]!));
    scheduler.completeVisible(accepted[0]!);

    expect(worker.posts[1]?.chunkRevision).toBe(3);
    expect(scheduler.latestTask('0,0,0')?.visibilityBarrierRevision).toBe(3);
    worker.emit(resultFor(worker.posts[1]!));
    scheduler.completeVisible(accepted[1]!);
    revision = 4;
    scheduler.request(0, 0, 0);
    expect(scheduler.latestTask('0,0,0')?.visibilityBarrierRevision).toBeUndefined();
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
