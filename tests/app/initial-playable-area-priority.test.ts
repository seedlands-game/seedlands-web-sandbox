import { describe, expect, it, vi } from 'vitest';
import {
  MeshTaskScheduler,
  type MeshWorkerPort,
  type WorkerResult,
} from '../../apps/web/src/app/world/mesh-task-scheduler';
import { PERFORMANCE_PROFILES } from '../../apps/web/src/client/presentation/performance-profile';
import { PerformanceTelemetry } from '../../apps/web/src/client/presentation/performance-telemetry';

class SlowWorker implements MeshWorkerPort {
  onmessage: ((event: MessageEvent<WorkerResult>) => void) | null = null;
  onerror: MeshWorkerPort['onerror'] = null;
  readonly posts: Array<Record<string, unknown>> = [];

  postMessage(message: Record<string, unknown>) {
    this.posts.push(message);
  }

  terminate() {}

  complete(post: Record<string, unknown>) {
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

describe('initial playable area priority', () => {
  it('把已排队的脚下3x3提升到单Worker前九个派发且不复制请求', async () => {
    const worker = new SlowWorker();
    const preparationReleases: Array<() => void> = [];
    const preparedKeys: string[] = [];
    const scheduler = new MeshTaskScheduler({
      worker,
      profile: PERFORMANCE_PROFILES.benchmark,
      telemetry: new PerformanceTelemetry({ now: () => 1 }),
      variant: 'main-snapshot',
      source: {
        beforePrepare: (cx, cy, cz) => {
          preparedKeys.push(`${cx},${cy},${cz}`);
          return new Promise<void>((resolve) => preparationReleases.push(resolve));
        },
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
    const streaming = [] as Array<readonly [number, number, number, number]>;
    for (let y = 0; y <= 1; y += 1)
      for (let z = -2; z <= 2; z += 1)
        for (let x = -2; x <= 2; x += 1) streaming.push([x, y, z, Math.abs(x) + Math.abs(z)]);
    streaming.sort((left, right) => left[3] - right[3]);
    const required = new Set<string>();
    for (let z = -1; z <= 1; z += 1) for (let x = -1; x <= 1; x += 1) required.add(`${x},0,${z}`);
    const oldLastRequiredDispatch = Math.max(
      ...streaming.map(([x, y, z], index) => (required.has(`${x},${y},${z}`) ? index + 1 : 0)),
    );
    expect(oldLastRequiredDispatch * 2_000).toBeGreaterThan(30_000);

    for (const [x, y, z] of streaming) scheduler.request(x, y, z);
    for (let z = -1; z <= 1; z += 1)
      for (let x = -1; x <= 1; x += 1) scheduler.request(x, 0, z, { priority: 'interactive' });
    expect(scheduler.requestedKeys.size).toBe(streaming.length);

    for (let index = 0; index < required.size; index += 1) {
      preparationReleases[index]!();
      await vi.waitFor(() => expect(worker.posts).toHaveLength(index + 1));
      worker.complete(worker.posts[index]!);
      if (index + 1 < required.size) await vi.waitFor(() => expect(preparationReleases).toHaveLength(index + 2));
    }

    expect(new Set(preparedKeys.slice(0, required.size))).toEqual(required);
    expect(required.size * 2_000).toBeLessThan(30_000);
    await vi.waitFor(() => expect(preparationReleases).toHaveLength(required.size + 1));
    expect(required.has(preparedKeys[required.size]!)).toBe(false);
    scheduler.dispose();
  });
});
