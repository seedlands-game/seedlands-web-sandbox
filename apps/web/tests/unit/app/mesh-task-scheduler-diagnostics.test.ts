import { describe, expect, it, vi } from 'vitest';
import { PERFORMANCE_PROFILES } from '../../../src/client/presentation/performance-profile';
import { PerformanceTelemetry } from '../../../src/client/presentation/performance-telemetry';
import { MeshTaskScheduler, type MeshWorkerPort, type WorkerResult } from '../../../src/app/world/mesh-task-scheduler';
import { testWorldgenProvider } from '../client/fixtures/worldgen-provider';
import { meshChunk } from '@seedlands/stdlib/world/mesh';
import { CHUNK_SIZE, Voxel, voxelIndex } from '@seedlands/stdlib/world/voxel';

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

const createScheduler = (
  worker: FakeWorker,
  accepted: WorkerResult[],
  releasePrepared = vi.fn(),
  telemetry = new PerformanceTelemetry({ now: () => 1 }),
) =>
  new MeshTaskScheduler({
    worker,
    profile: PERFORMANCE_PROFILES.benchmark,
    telemetry,
    variant: 'main-snapshot',
    source: {
      provider: testWorldgenProvider,
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

describe('MeshTaskScheduler diagnostics', () => {
  it.each([0, 1])('请求屏障与accepted worker的%d个分片关联到实际未完成trace', async (partsTotal) => {
    const worker = new FakeWorker();
    const accepted: WorkerResult[] = [];
    const telemetry = new PerformanceTelemetry({ now: () => 1 });
    const scheduler = createScheduler(worker, accepted, vi.fn(), telemetry);
    scheduler.protectVisibleRevision('2,0,0', 1);
    scheduler.request(2, 0, 0, { priority: 'interactive' });
    await vi.waitFor(() => expect(worker.posts).toHaveLength(1));
    const result = resultFor(worker.posts[0]!);
    if (partsTotal) {
      const data = new Uint16Array(CHUNK_SIZE ** 3);
      data[voxelIndex(1, 1, 1)] = Voxel.Stone;
      result.meshes = Object.values(
        meshChunk({ seed: 7, cx: 2, cy: 0, cz: 0, data, changes: [], outside: () => Voxel.Air }),
      ).filter((mesh) => mesh.indices.length > 0);
    }
    expect(result.meshes).toHaveLength(partsTotal);
    worker.emit(result);
    await vi.waitFor(() => expect(accepted).toEqual([result]));
    const events = telemetry.exportChromeTrace().traceEvents;
    expect(events).toContainEqual(
      expect.objectContaining({
        name: 'request-state',
        args: expect.objectContaining({
          traceId: result.traceId,
          traceName: '2,0,0',
          priority: 'interactive',
          visibilityBarrierRevision: 1,
          state: 'queued',
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        name: 'commit-queued',
        args: expect.objectContaining({
          traceId: result.traceId,
          partsTotal,
          taskId: result.taskId,
          chunkRevision: 1,
        }),
      }),
    );
    expect(telemetry.trace(result.traceId)?.complete).toBe(false);
    scheduler.dispose();
  });
});
