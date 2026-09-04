import { createMeshTaskSnapshot, isCurrentMeshTask } from '../client/mesh-task-snapshot';
import type { PerformanceProfile } from '../client/performance-profile';
import type { PerformanceTelemetry } from '../client/performance-telemetry';
import { GENERATOR_VERSION, chunkKey } from '../world/voxel';
import type { PendingMeshTask, StreamingVariant, WorkerResult } from './app-contracts';

export type { WorkerResult } from './app-contracts';

type PendingMeshRequest = {
  traceId: string;
  epoch: number;
  chunkKey: string;
  cx: number;
  cy: number;
  cz: number;
  queuedAt: number;
};

type MainSnapshot = {
  chunkRevision: number;
  haloRevision: string;
  canonical: Uint16Array;
  halo: Uint16Array;
};

type WorkerOverlay = {
  cx: number;
  cy: number;
  cz: number;
  voxels: Uint16Array;
};

type WorkerInput = {
  chunkRevision: number;
  generatorVersion: number;
  canonical?: Uint16Array;
  overlays: WorkerOverlay[];
};

export type MeshTaskSource = {
  seed: number;
  prepareMainSnapshot: (cx: number, cy: number, cz: number) => MainSnapshot;
  prepareWorkerInput: (cx: number, cy: number, cz: number) => WorkerInput;
  acceptWorkerCanonical: (task: PendingMeshTask, result: WorkerResult) => boolean;
};

export type MeshWorkerPort = {
  onmessage: ((event: MessageEvent<WorkerResult>) => void) | null;
  postMessage: (message: Record<string, unknown>, transfer: Transferable[]) => void;
  terminate: () => void;
};

type SchedulerOptions = {
  worker: MeshWorkerPort;
  source: MeshTaskSource;
  telemetry: PerformanceTelemetry;
  profile: PerformanceProfile;
  variant: StreamingVariant;
  onAcceptedResult: (task: PendingMeshTask, result: WorkerResult) => void;
};

export class MeshTaskScheduler {
  private readonly queued = new Map<string, PendingMeshRequest>();
  private readonly latestTasks = new Map<string, PendingMeshTask>();
  private readonly requested = new Set<string>();
  private readonly scenarioTraceIds = new Set<string>();
  private taskSequence = 0;
  private inFlight = 0;
  private epoch = 0;
  private disposed = false;
  private variant: StreamingVariant;

  constructor(private readonly options: SchedulerOptions) {
    this.variant = options.variant;
    options.worker.onmessage = (event) => this.receive(event.data);
  }

  get generationQueueSize() {
    return this.queued.size;
  }

  get meshingQueueSize() {
    return this.inFlight;
  }

  get requestedKeys(): ReadonlySet<string> {
    return this.requested;
  }

  get traceIds(): ReadonlySet<string> {
    return this.scenarioTraceIds;
  }

  setVariant(variant: StreamingVariant) {
    if (this.variant === variant) return false;
    this.variant = variant;
    return true;
  }

  beginScenario() {
    this.epoch += 1;
    this.queued.clear();
    this.latestTasks.clear();
    this.requested.clear();
    this.scenarioTraceIds.clear();
    this.options.telemetry.counter('scenario_epoch', this.epoch);
  }

  request(cx: number, cy: number, cz: number, forceRemesh = false) {
    if (this.disposed || cy < 0 || cy > 1) return;
    const key = chunkKey(cx, cy, cz);
    if (!forceRemesh && this.requested.has(key)) return;
    const traceId = this.options.telemetry.beginTrace('chunk-request', key, 'main');
    this.scenarioTraceIds.add(traceId);
    this.requested.add(key);
    this.latestTasks.delete(key);
    this.queued.delete(key);
    this.queued.set(key, { traceId, epoch: this.epoch, chunkKey: key, cx, cy, cz, queuedAt: performance.now() });
    this.options.telemetry.markTrace(traceId, 'queued', 'main');
    this.drain();
  }

  latestTask(key: string) {
    return this.latestTasks.get(key);
  }

  isCurrent(task: PendingMeshTask) {
    const current = this.latestTasks.get(task.chunkKey);
    return current ? isCurrentMeshTask(task, current) : false;
  }

  cancel(key: string) {
    const task = this.latestTasks.get(key);
    if (task) this.options.telemetry.markTrace(task.traceId, 'cancelled', 'main');
    this.latestTasks.delete(key);
    this.requested.delete(key);
    this.queued.delete(key);
  }

  cancelOutside(cx: number, cz: number, radius: number) {
    for (const key of this.requested) {
      const [x, , z] = key.split(',').map(Number);
      if (Math.abs(x - cx) > radius || Math.abs(z - cz) > radius) this.cancel(key);
    }
  }

  completeVisible(task: PendingMeshTask) {
    if (!this.isCurrent(task)) return;
    this.requested.delete(task.chunkKey);
    this.latestTasks.delete(task.chunkKey);
    this.options.telemetry.completeTrace(task.traceId, 'visible-postrender', 'main');
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.options.worker.onmessage = null;
    this.options.worker.terminate();
    this.queued.clear();
    this.latestTasks.clear();
    this.requested.clear();
  }

  private drain() {
    while (!this.disposed && this.inFlight < this.options.profile.maxWorkerTasksInFlight) {
      const next = this.queued.entries().next().value as [string, PendingMeshRequest] | undefined;
      if (!next) return;
      const [key, request] = next;
      this.queued.delete(key);
      if (!this.requested.has(key) || request.epoch !== this.epoch) {
        this.options.telemetry.markTrace(request.traceId, 'stale-request', 'main');
        continue;
      }
      this.options.telemetry.recordCompletedSpan({
        category: 'worker',
        name: 'WorkerQueueWait',
        lane: 'main',
        durationMs: performance.now() - request.queuedAt,
        traceId: request.traceId,
      });
      if (this.variant === 'main-snapshot') this.postMainSnapshot(request);
      else this.postWorkerFirst(request);
    }
  }

  private postMainSnapshot(request: PendingMeshRequest) {
    const span = this.options.telemetry.beginSpan('streaming', 'HaloSnapshot', 'main', request.traceId);
    const snapshot = this.options.source.prepareMainSnapshot(request.cx, request.cy, request.cz);
    this.options.telemetry.endSpan(span);
    const snapshotTask = createMeshTaskSnapshot({
      taskId: ++this.taskSequence,
      epoch: request.epoch,
      chunkKey: request.chunkKey,
      chunkRevision: snapshot.chunkRevision,
      haloRevision: snapshot.haloRevision,
      canonical: snapshot.canonical,
      halo: snapshot.halo,
    });
    const task: PendingMeshTask = {
      ...snapshotTask,
      traceId: request.traceId,
      seed: this.options.source.seed,
      cx: request.cx,
      cy: request.cy,
      cz: request.cz,
      generatorVersion: GENERATOR_VERSION,
      variant: 'main-snapshot',
    };
    this.latestTasks.set(request.chunkKey, task);
    this.inFlight += 1;
    this.options.telemetry.markTrace(task.traceId, 'worker-start', 'worker-derived');
    this.options.worker.postMessage(
      {
        kind: 'mesh',
        taskId: task.taskId,
        traceId: task.traceId,
        epoch: task.epoch,
        chunkKey: task.chunkKey,
        seed: task.seed,
        cx: task.cx,
        cy: task.cy,
        cz: task.cz,
        chunkRevision: task.chunkRevision,
        haloRevision: task.haloRevision,
        canonical: snapshotTask.canonical.buffer,
        halo: snapshotTask.halo.buffer,
      },
      [snapshotTask.canonical.buffer, snapshotTask.halo.buffer],
    );
  }

  private postWorkerFirst(request: PendingMeshRequest) {
    const span = this.options.telemetry.beginSpan('streaming', 'AuthorityOverlayCopy', 'main', request.traceId);
    const prepared = this.options.source.prepareWorkerInput(request.cx, request.cy, request.cz);
    this.options.telemetry.endSpan(span);
    const task: PendingMeshTask = {
      taskId: ++this.taskSequence,
      epoch: request.epoch,
      chunkKey: request.chunkKey,
      chunkRevision: prepared.chunkRevision,
      haloRevision: `worker-input-${this.taskSequence}`,
      traceId: request.traceId,
      seed: this.options.source.seed,
      cx: request.cx,
      cy: request.cy,
      cz: request.cz,
      generatorVersion: prepared.generatorVersion,
      variant: 'worker-first',
    };
    this.latestTasks.set(request.chunkKey, task);
    this.inFlight += 1;
    this.options.telemetry.markTrace(task.traceId, 'worker-start', 'worker-derived');
    const transfers: Transferable[] = [];
    if (prepared.canonical) transfers.push(prepared.canonical.buffer);
    prepared.overlays.forEach((overlay) => transfers.push(overlay.voxels.buffer));
    this.options.worker.postMessage(
      {
        kind: 'generate-mesh',
        taskId: task.taskId,
        traceId: task.traceId,
        epoch: task.epoch,
        chunkKey: task.chunkKey,
        seed: task.seed,
        cx: task.cx,
        cy: task.cy,
        cz: task.cz,
        chunkRevision: task.chunkRevision,
        haloRevision: task.haloRevision,
        generatorVersion: task.generatorVersion,
        ...(prepared.canonical ? { canonical: prepared.canonical.buffer } : {}),
        overlays: prepared.overlays.map((overlay) => ({
          cx: overlay.cx,
          cy: overlay.cy,
          cz: overlay.cz,
          voxels: overlay.voxels.buffer,
        })),
      },
      transfers,
    );
  }

  private receive(result: WorkerResult) {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const task = this.latestTasks.get(result.chunkKey);
    if (!task || !isCurrentMeshTask(result, task)) {
      this.incrementCounter('stale_worker_results');
      this.drain();
      return;
    }
    if (task.variant === 'worker-first') {
      if (!result.canonical || result.generatorVersion !== task.generatorVersion) {
        this.discard(task, 'invalid-worker-canonical');
        this.drain();
        return;
      }
      if (!this.options.source.acceptWorkerCanonical(task, result)) {
        this.discard(task, 'stale-worker-canonical');
        this.drain();
        return;
      }
      this.recordWorkerPreparation(task, result);
    }
    this.options.telemetry.recordCompletedSpan({
      category: 'meshing',
      name: 'WorkerMesh',
      lane: 'worker-derived',
      durationMs: result.workerMeshingMs,
      traceId: task.traceId,
    });
    this.options.telemetry.markTrace(task.traceId, 'worker-complete', 'worker-derived');
    this.options.onAcceptedResult(task, result);
    this.options.telemetry.markTrace(task.traceId, 'commit-queued', 'main');
    this.drain();
  }

  private recordWorkerPreparation(task: PendingMeshTask, result: WorkerResult) {
    if (result.workerGenerationMs !== undefined)
      this.options.telemetry.recordCompletedSpan({
        category: 'worldgen',
        name: 'WorkerGeneration',
        lane: 'worker-derived',
        durationMs: result.workerGenerationMs,
        traceId: task.traceId,
      });
    if (result.workerHaloMs !== undefined)
      this.options.telemetry.recordCompletedSpan({
        category: 'streaming',
        name: 'WorkerHaloSample',
        lane: 'worker-derived',
        durationMs: result.workerHaloMs,
        traceId: task.traceId,
      });
  }

  private discard(task: PendingMeshTask, counter: string) {
    this.options.telemetry.markTrace(task.traceId, counter, 'main');
    this.incrementCounter(counter);
  }

  private incrementCounter(counter: string) {
    this.options.telemetry.counter(counter, (this.options.telemetry.snapshot().gauges[counter] ?? 0) + 1);
  }
}
