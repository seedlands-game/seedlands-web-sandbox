import { createMeshTaskSnapshot, isCurrentMeshTask } from '../client/mesh-task-snapshot';
import type { PerformanceProfile } from '../client/performance-profile';
import type { PerformanceTelemetry } from '../client/performance-telemetry';
import { chunkKey } from '../world/voxel';
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
  priority: MeshRequestPriority;
};

export type MeshRequestPriority = 'streaming' | 'interactive' | 'interactive-fluid';
export type MeshRequestOptions = { forceRemesh?: boolean; priority?: MeshRequestPriority };

type MainSnapshot = {
  chunkRevision: number;
  haloRevision: string;
  canonical: Uint16Array;
  halo: Uint16Array;
  fluid?: Uint8Array;
  fluidHalo?: Uint8Array;
};

type WorkerOverlay = {
  cx: number;
  cy: number;
  cz: number;
  voxels: Uint16Array;
  fluid?: Uint8Array;
};

type WorkerInput = {
  chunkRevision: number;
  generatorVersion: number;
  canonical?: Uint16Array;
  fluid?: Uint8Array;
  overlays: WorkerOverlay[];
};

export type MeshTaskSource = {
  seed: number;
  generatorVersion: number;
  beforePrepare?: (cx: number, cy: number, cz: number) => Promise<void>;
  releasePrepared?: (cx: number, cy: number, cz: number) => void;
  prepareMainSnapshot: (cx: number, cy: number, cz: number) => MainSnapshot;
  prepareWorkerInput: (cx: number, cy: number, cz: number) => WorkerInput;
  acceptWorkerCanonical: (task: PendingMeshTask, result: WorkerResult) => boolean | Promise<boolean>;
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
  private readonly replacements = new Map<string, PendingMeshRequest>();
  private readonly inFlightKeys = new Set<string>();
  private readonly scenarioTraceIds = new Set<string>();
  private taskSequence = 0;
  private inFlight = 0;
  private epoch = 0;
  private disposed = false;
  private draining = false;
  private variant: StreamingVariant;
  private mergedRequests = 0;
  private supersededInFlight = 0;

  constructor(private readonly options: SchedulerOptions) {
    this.variant = options.variant;
    options.worker.onmessage = (event) => void this.receive(event.data);
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

  get fluidSchedulingMetrics() {
    return { mergedRequests: this.mergedRequests, supersededInFlight: this.supersededInFlight };
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
    this.replacements.clear();
    this.inFlightKeys.clear();
    this.scenarioTraceIds.clear();
    this.options.telemetry.counter('scenario_epoch', this.epoch);
  }

  request(cx: number, cy: number, cz: number, options: boolean | MeshRequestOptions = false) {
    if (this.disposed || cy < 0 || cy > 1) return;
    const forceRemesh = typeof options === 'boolean' ? options : (options.forceRemesh ?? false);
    const priority = typeof options === 'boolean' ? 'streaming' : (options.priority ?? 'streaming');
    const key = chunkKey(cx, cy, cz);
    if (!forceRemesh && this.requested.has(key)) return;
    const existing = this.queued.get(key) ?? this.replacements.get(key);
    const traceId = existing?.traceId ?? this.options.telemetry.beginTrace('chunk-request', key, 'main');
    this.scenarioTraceIds.add(traceId);
    this.requested.add(key);
    const request: PendingMeshRequest = {
      traceId,
      epoch: this.epoch,
      chunkKey: key,
      cx,
      cy,
      cz,
      queuedAt: existing?.queuedAt ?? performance.now(),
      priority: this.higherPriority(existing?.priority, priority),
    };
    if (existing) this.mergedRequests += 1;
    if (this.inFlightKeys.has(key)) {
      this.replacements.set(key, request);
      return;
    }
    this.latestTasks.delete(key);
    this.queued.set(key, request);
    this.options.telemetry.markTrace(traceId, 'queued', 'main');
    void this.drain();
  }

  latestTask(key: string) {
    return this.latestTasks.get(key);
  }

  isCurrent(task: PendingMeshTask) {
    const current = this.latestTasks.get(task.chunkKey);
    return current && !this.replacements.has(task.chunkKey) ? isCurrentMeshTask(task, current) : false;
  }

  cancel(key: string) {
    const task = this.latestTasks.get(key);
    if (task) this.options.telemetry.markTrace(task.traceId, 'cancelled', 'main');
    this.latestTasks.delete(key);
    this.inFlightKeys.delete(key);
    this.replacements.delete(key);
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
    this.replacements.clear();
    this.inFlightKeys.clear();
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (!this.disposed && this.inFlight < this.options.profile.maxWorkerTasksInFlight) {
        const next = this.nextQueuedRequest();
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
        try {
          if (this.options.source.beforePrepare)
            await this.options.source.beforePrepare(request.cx, request.cy, request.cz);
        } catch {
          this.options.source.releasePrepared?.(request.cx, request.cy, request.cz);
          if (!this.queued.has(key)) {
            this.requested.delete(key);
            this.latestTasks.delete(key);
          }
          this.options.telemetry.completeTrace(request.traceId, 'persistence-load-error', 'persistence-worker');
          continue;
        }
        if (this.disposed || !this.requested.has(key) || request.epoch !== this.epoch || this.queued.has(key)) {
          this.options.source.releasePrepared?.(request.cx, request.cy, request.cz);
          this.options.telemetry.markTrace(request.traceId, 'stale-after-persistence-load', 'main');
          continue;
        }
        if (this.variant === 'main-snapshot') this.postMainSnapshot(request);
        else this.postWorkerFirst(request);
      }
    } finally {
      this.draining = false;
      if (!this.disposed && this.queued.size && this.inFlight < this.options.profile.maxWorkerTasksInFlight)
        void this.drain();
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
      fluid: snapshot.fluid,
      fluidHalo: snapshot.fluidHalo,
    });
    const task: PendingMeshTask = {
      ...snapshotTask,
      traceId: request.traceId,
      seed: this.options.source.seed,
      cx: request.cx,
      cy: request.cy,
      cz: request.cz,
      generatorVersion: this.options.source.generatorVersion,
      variant: 'main-snapshot',
    };
    this.latestTasks.set(request.chunkKey, task);
    this.inFlight += 1;
    this.inFlightKeys.add(request.chunkKey);
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
        fluid: snapshotTask.fluid!.buffer,
        fluidHalo: snapshotTask.fluidHalo!.buffer,
      },
      [
        snapshotTask.canonical.buffer,
        snapshotTask.halo.buffer,
        snapshotTask.fluid!.buffer,
        snapshotTask.fluidHalo!.buffer,
      ],
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
    this.inFlightKeys.add(request.chunkKey);
    this.options.telemetry.markTrace(task.traceId, 'worker-start', 'worker-derived');
    const transfers: Transferable[] = [];
    if (prepared.canonical) transfers.push(prepared.canonical.buffer);
    if (prepared.fluid) transfers.push(prepared.fluid.buffer);
    prepared.overlays.forEach((overlay) => {
      transfers.push(overlay.voxels.buffer);
      if (overlay.fluid) transfers.push(overlay.fluid.buffer);
    });
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
        ...(prepared.fluid ? { fluid: prepared.fluid.buffer } : {}),
        overlays: prepared.overlays.map((overlay) => ({
          cx: overlay.cx,
          cy: overlay.cy,
          cz: overlay.cz,
          voxels: overlay.voxels.buffer,
          ...(overlay.fluid ? { fluid: overlay.fluid.buffer } : {}),
        })),
      },
      transfers,
    );
  }

  private async receive(result: WorkerResult) {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.inFlightKeys.delete(result.chunkKey);
    const task = this.latestTasks.get(result.chunkKey);
    if (!task || !isCurrentMeshTask(result, task)) {
      this.incrementCounter('stale_worker_results');
      void this.drain();
      return;
    }
    const replacement = this.replacements.get(result.chunkKey);
    if (replacement) {
      this.replacements.delete(result.chunkKey);
      this.latestTasks.delete(result.chunkKey);
      this.queued.set(result.chunkKey, replacement);
      this.supersededInFlight += 1;
      this.options.telemetry.completeTrace(task.traceId, 'superseded-worker-result', 'main');
      void this.drain();
      return;
    }
    if (task.variant === 'worker-first') {
      if (!result.canonical || result.generatorVersion !== task.generatorVersion) {
        this.discard(task, 'invalid-worker-canonical');
        void this.drain();
        return;
      }
      if (!(await this.options.source.acceptWorkerCanonical(task, result))) {
        this.discard(task, 'stale-worker-canonical');
        void this.drain();
        return;
      }
      if (!this.isCurrent(task)) {
        this.discard(task, 'stale-after-authority-accept');
        void this.drain();
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
    void this.drain();
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

  private nextQueuedRequest(): [string, PendingMeshRequest] | undefined {
    const rank: Record<MeshRequestPriority, number> = { streaming: 0, interactive: 1, 'interactive-fluid': 2 };
    let selected: [string, PendingMeshRequest] | undefined;
    for (const entry of this.queued) {
      if (
        !selected ||
        rank[entry[1].priority] > rank[selected[1].priority] ||
        (rank[entry[1].priority] === rank[selected[1].priority] && entry[1].queuedAt < selected[1].queuedAt)
      )
        selected = entry;
    }
    return selected;
  }

  private higherPriority(current: MeshRequestPriority | undefined, next: MeshRequestPriority): MeshRequestPriority {
    if (current === 'interactive-fluid' || next === 'interactive-fluid') return 'interactive-fluid';
    if (current === 'interactive' || next === 'interactive') return 'interactive';
    return 'streaming';
  }

  private discard(task: PendingMeshTask, counter: string) {
    this.options.telemetry.markTrace(task.traceId, counter, 'main');
    this.incrementCounter(counter);
  }

  private incrementCounter(counter: string) {
    this.options.telemetry.counter(counter, (this.options.telemetry.snapshot().gauges[counter] ?? 0) + 1);
  }
}
