import { isCurrentMeshTask } from '../../client/compute/mesh-task-snapshot';
import { chunkKey } from '@seedlands/game-core/world/voxel';
import type { PendingMeshTask, StreamingVariant, WorkerResult } from '../app-contracts';
import { createMainSnapshotDispatch, type MeshTaskDispatch } from './mesh-task-dispatch';
import {
  acceptSourceMeshResult,
  assertMeshSourceVariant,
  prepareSourceWorkerDispatch,
  type MeshTaskSchedulerOptions,
} from './mesh-task-source';
import { recordMeshPreparationFailure } from './mesh-preparation-telemetry';
import { MeshVisibilityBarriers } from './mesh-visibility-barriers';

export type { WorkerResult } from '../app-contracts';
export type { MeshTaskSource, MeshWorkerPort } from './mesh-task-source';

type PendingMeshRequest = {
  traceId: string;
  epoch: number;
  chunkKey: string;
  cx: number;
  cy: number;
  cz: number;
  queuedAt: number;
  priority: MeshRequestPriority;
  enqueuedAtDispatch: number;
  visibilityBarrierRevision?: number;
};

export type MeshRequestPriority = 'streaming' | 'interactive' | 'interactive-fluid';
export type MeshRequestOptions = { forceRemesh?: boolean; priority?: MeshRequestPriority };

export class MeshTaskScheduler {
  private readonly queued = new Map<string, PendingMeshRequest>();
  private readonly latestTasks = new Map<string, PendingMeshTask>();
  private readonly requested = new Set<string>();
  private readonly replacements = new Map<string, PendingMeshRequest>();
  private readonly preparingRequests = new Map<string, PendingMeshRequest>();
  private readonly failedPreparations = new Map<string, PendingMeshRequest>();
  private readonly visibility = new MeshVisibilityBarriers<PendingMeshRequest>();
  private readonly inFlightKeys = new Set<string>();
  private readonly scenarioTraceIds = new Set<string>();
  private taskSequence = 0;
  private inFlight = 0;
  private dispatchCount = 0;
  private readonly activeTasks = new Map<number, PendingMeshTask>();
  private readonly receivingTasks = new Set<number>();
  private readonly inputSettlements = new Map<number, () => void>();
  private epoch = 0;
  private disposed = false;
  private draining = false;
  private variant: StreamingVariant;
  private mergedRequests = 0;
  private supersededInFlight = 0;

  constructor(private readonly options: MeshTaskSchedulerOptions) {
    assertMeshSourceVariant(options.source, options.variant);
    this.variant = options.variant;
    options.worker.onmessage = (event) => void this.receive(event.data);
    options.worker.onerror = ({ taskId, error }) => this.fail(taskId, error);
  }

  get generationQueueSize() {
    return this.queued.size + this.preparingRequests.size + this.failedPreparations.size;
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
    assertMeshSourceVariant(this.options.source, variant);
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
    this.preparingRequests.clear();
    this.failedPreparations.clear();
    this.visibility.reset();
    this.inFlightKeys.clear();
    this.scenarioTraceIds.clear();
    this.options.telemetry.counter('scenario_epoch', this.epoch);
  }

  request(cx: number, cy: number, cz: number, options: boolean | MeshRequestOptions = false) {
    if (this.disposed || cy < 0 || cy > 1) return;
    const forceRemesh = typeof options === 'boolean' ? options : (options.forceRemesh ?? false);
    const key = chunkKey(cx, cy, cz);
    if (!forceRemesh && this.requested.has(key)) return;
    const failed = this.failedPreparations.get(key);
    if (failed) {
      this.failedPreparations.delete(key);
      this.requested.delete(key);
    }
    const requestedPriority = typeof options === 'boolean' ? 'streaming' : (options.priority ?? 'streaming');
    const delayedUntilVisible = this.visibility.isDelaying(key);
    const existing = delayedUntilVisible
      ? this.visibility.existingDeferred(key)
      : (this.queued.get(key) ?? this.replacements.get(key));
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
      priority: this.higherPriority(existing?.priority ?? failed?.priority, requestedPriority),
      enqueuedAtDispatch: existing?.enqueuedAtDispatch ?? failed?.enqueuedAtDispatch ?? this.dispatchCount,
      ...(this.visibility.revisionForRequest(key) === undefined
        ? {}
        : { visibilityBarrierRevision: this.visibility.revisionForRequest(key)! }),
    };
    if (existing) this.mergedRequests += 1;
    if (delayedUntilVisible) {
      this.visibility.defer(key, request);
      return;
    }
    if (this.preparingRequests.has(key) || this.inFlightKeys.has(key)) {
      this.replacements.set(key, request);
      return;
    }
    this.latestTasks.delete(key);
    this.queued.set(key, request);
    this.options.telemetry.markTrace(traceId, 'queued', 'main');
    void this.drain();
  }

  protectVisibleRevision(key: string, revision: number) {
    if (this.disposed) return;
    this.visibility.protect(key, revision, this.latestTasks.get(key));
  }

  latestTask(key: string) {
    return this.latestTasks.get(key);
  }

  isCurrent(task: PendingMeshTask) {
    const current = this.latestTasks.get(task.chunkKey);
    return current && !this.replacements.has(task.chunkKey) ? isCurrentMeshTask(task, current) : false;
  }

  retryFailedPreparations() {
    const failed = [...this.failedPreparations.values()];
    failed.forEach((request) => {
      if (this.failedPreparations.get(request.chunkKey) !== request || request.epoch !== this.epoch) return;
      this.failedPreparations.delete(request.chunkKey);
      this.requested.delete(request.chunkKey);
      this.request(request.cx, request.cy, request.cz, { forceRemesh: true, priority: request.priority });
    });
  }

  cancel(key: string) {
    const task = this.latestTasks.get(key);
    this.latestTasks.delete(key);
    this.replacements.delete(key);
    this.failedPreparations.delete(key);
    this.requested.delete(key);
    this.queued.delete(key);
    this.preparingRequests.delete(key);
    this.visibility.cancel(key);
    if (task) {
      this.options.telemetry.markTrace(task.traceId, 'cancelled', 'main');
      this.options.worker.postMessage({ kind: 'cancel-mesh', taskId: task.taskId }, []);
    }
  }

  cancelOutside(cx: number, cz: number, radius: number) {
    for (const key of this.requested) {
      const [x, , z] = key.split(',').map(Number);
      if (Math.abs(x - cx) > radius || Math.abs(z - cz) > radius) this.cancel(key);
    }
  }

  completeVisible(task: PendingMeshTask) {
    if (!this.isCurrent(task)) return;
    this.options.telemetry.completeTrace(task.traceId, 'visible-postrender', 'main');
    const completedBarrier = this.visibility.complete(task);
    if (completedBarrier?.deferred) {
      this.latestTasks.delete(task.chunkKey);
      const successor = {
        ...completedBarrier.deferred,
        ...(completedBarrier.nextBarrier === undefined
          ? {}
          : { visibilityBarrierRevision: completedBarrier.nextBarrier }),
      };
      if (completedBarrier.nextBarrier === undefined) delete successor.visibilityBarrierRevision;
      this.queued.set(task.chunkKey, successor);
      this.options.telemetry.markTrace(successor.traceId, 'queued', 'main');
      void this.drain();
      return;
    }
    this.requested.delete(task.chunkKey);
    this.latestTasks.delete(task.chunkKey);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.options.worker.onmessage = null;
    this.options.worker.onerror = null;
    this.options.worker.terminate();
    for (const taskId of [...this.inputSettlements.keys()]) this.settleInput(taskId);
    for (const task of this.activeTasks.values()) this.options.source.releasePrepared?.(task.cx, task.cy, task.cz);
    this.activeTasks.clear();
    this.inFlight = 0;
    this.queued.clear();
    this.latestTasks.clear();
    this.requested.clear();
    this.replacements.clear();
    this.preparingRequests.clear();
    this.failedPreparations.clear();
    this.visibility.reset();
    this.inFlightKeys.clear();
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (!this.disposed && this.inFlight < this.options.profile.maxWorkerTasksInFlight) {
        const next = this.nextQueuedRequest();
        if (!next) return;
        const [key, queuedRequest] = next;
        let request = queuedRequest;
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
        this.preparingRequests.set(key, request);
        this.options.telemetry.markTrace(request.traceId, 'prepare-start', 'main');
        try {
          if (this.options.source.beforePrepare)
            await this.options.source.beforePrepare(request.cx, request.cy, request.cz);
        } catch (error) {
          recordMeshPreparationFailure(this.options.telemetry, request.traceId, error);
          const ownsPreparation = this.preparingRequests.get(key) === request;
          if (ownsPreparation) this.preparingRequests.delete(key);
          this.options.source.releasePrepared?.(request.cx, request.cy, request.cz);
          if (ownsPreparation) {
            const replacement = this.replacements.get(key);
            if (replacement) {
              this.replacements.delete(key);
              this.queued.set(key, replacement);
            } else if (!this.queued.has(key)) {
              this.latestTasks.delete(key);
              this.failedPreparations.set(key, request);
            }
          }
          this.options.telemetry.completeTrace(request.traceId, 'persistence-load-error', 'persistence-worker');
          continue;
        }
        this.options.telemetry.markTrace(request.traceId, 'prepare-end', 'main');
        if (
          this.disposed ||
          !this.requested.has(key) ||
          request.epoch !== this.epoch ||
          this.preparingRequests.get(key) !== request
        ) {
          this.options.source.releasePrepared?.(request.cx, request.cy, request.cz);
          this.options.telemetry.markTrace(request.traceId, 'stale-after-persistence-load', 'main');
          continue;
        }
        this.preparingRequests.delete(key);
        const preparedReplacement = this.replacements.get(key);
        if (preparedReplacement) {
          this.replacements.delete(key);
          this.options.telemetry.completeTrace(request.traceId, 'superseded-during-prepare', 'main');
          request = preparedReplacement;
        }
        try {
          if (this.variant === 'main-snapshot') this.postMainSnapshot(request);
          else this.postWorkerFirst(request);
        } catch (error) {
          const task = this.latestTasks.get(key);
          if (task && this.activeTasks.has(task.taskId))
            this.fail(task.taskId, error instanceof Error ? error : new Error(String(error)));
          else {
            this.options.source.releasePrepared?.(request.cx, request.cy, request.cz);
            const replacement = this.replacements.get(key);
            if (replacement) {
              this.replacements.delete(key);
              this.queued.set(key, replacement);
            } else this.requested.delete(key);
            this.options.telemetry.completeTrace(request.traceId, 'mesh-prepare-error', 'main');
          }
        }
      }
    } finally {
      this.draining = false;
      if (!this.disposed && this.queued.size && this.inFlight < this.options.profile.maxWorkerTasksInFlight)
        void this.drain();
    }
  }

  private postMainSnapshot(request: PendingMeshRequest) {
    if (this.options.source.kind === 'authority-complete') throw new TypeError('Complete input cannot use snapshots.');
    const span = this.options.telemetry.beginSpan('streaming', 'HaloSnapshot', 'main', request.traceId);
    const snapshot = this.options.source.prepareMainSnapshot(request.cx, request.cy, request.cz);
    this.options.telemetry.endSpan(span);
    this.postDispatch(
      request,
      createMainSnapshotDispatch(
        ++this.taskSequence,
        request,
        this.options.source.seed,
        this.options.source.generatorVersion,
        snapshot,
      ),
    );
  }

  private postWorkerFirst(request: PendingMeshRequest) {
    const prepared = prepareSourceWorkerDispatch(
      this.options.source,
      request,
      ++this.taskSequence,
      this.options.telemetry,
    );
    const taskId = prepared.dispatch.task.taskId;
    if (prepared.settle) this.inputSettlements.set(taskId, prepared.settle);
    try {
      this.postDispatch(request, prepared.dispatch);
    } catch (error) {
      this.settleInput(taskId);
      throw error;
    }
  }

  private postDispatch(request: PendingMeshRequest, dispatch: MeshTaskDispatch) {
    const { task } = dispatch;
    this.latestTasks.set(request.chunkKey, task);
    this.inFlight += 1;
    this.activeTasks.set(task.taskId, task);
    this.dispatchCount += 1;
    this.inFlightKeys.add(request.chunkKey);
    this.options.telemetry.markTrace(task.traceId, 'worker-start', 'worker-derived');
    this.options.worker.postMessage(dispatch.message, dispatch.transfers);
  }

  private async receive(result: WorkerResult) {
    const active = this.activeTasks.get(result.taskId);
    if (!active || this.disposed || this.receivingTasks.has(result.taskId)) {
      this.incrementCounter('stale_worker_results');
      return;
    }
    this.receivingTasks.add(result.taskId);
    try {
      const task = this.latestTasks.get(result.chunkKey);
      if (!task || !isCurrentMeshTask(result, task)) {
        this.incrementCounter('stale_worker_results');
        return;
      }
      const replacement = this.replacements.get(result.chunkKey);
      const presentsBarrier = this.visibility.presents(task);
      if (replacement && !presentsBarrier) {
        this.replacements.delete(result.chunkKey);
        this.latestTasks.delete(result.chunkKey);
        this.queued.set(result.chunkKey, replacement);
        this.supersededInFlight += 1;
        this.options.telemetry.completeTrace(task.traceId, 'superseded-worker-result', 'main');
        return;
      }
      if (presentsBarrier) {
        this.visibility.hold(task, replacement);
        this.replacements.delete(task.chunkKey);
      }
      if (task.variant === 'worker-first') {
        if (!result.canonical || result.generatorVersion !== task.generatorVersion) {
          this.releaseBarrierAttempt(task);
          this.discard(task, 'invalid-worker-canonical');
          return;
        }
        if (!(await acceptSourceMeshResult(this.options.source, task, result))) {
          this.releaseBarrierAttempt(task);
          this.discard(task, 'stale-worker-canonical');
          return;
        }
        if (!this.isCurrent(task)) {
          this.releaseBarrierAttempt(task);
          this.discard(task, 'stale-after-authority-accept');
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
    } catch (error) {
      this.fail(result.taskId, error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.finishTask(active);
      void this.drain();
    }
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
    const priority = (request: PendingMeshRequest) =>
      rank[request.priority] + Math.floor((this.dispatchCount - request.enqueuedAtDispatch) / 8);
    return [...this.queued.entries()].sort(
      (left, right) => priority(right[1]) - priority(left[1]) || left[1].queuedAt - right[1].queuedAt,
    )[0];
  }

  fail(taskId: number, _error: Error): void {
    const task = this.activeTasks.get(taskId);
    if (!task || this.disposed) return;
    this.releaseBarrierAttempt(task);
    const replacement = this.replacements.get(task.chunkKey);
    if (replacement) {
      this.replacements.delete(task.chunkKey);
      this.queued.set(task.chunkKey, replacement);
    } else if (this.latestTasks.get(task.chunkKey)?.taskId === taskId) {
      this.requested.delete(task.chunkKey);
    }
    if (this.latestTasks.get(task.chunkKey)?.taskId === taskId) this.latestTasks.delete(task.chunkKey);
    this.options.telemetry.completeTrace(task.traceId, 'mesh-task-failed', 'worker-derived');
    this.incrementCounter('mesh_task_failures');
    this.finishTask(task);
    void this.drain();
  }

  private finishTask(task: PendingMeshTask) {
    if (!this.activeTasks.delete(task.taskId)) return;
    this.settleInput(task.taskId);
    this.receivingTasks.delete(task.taskId);
    this.inFlight = this.activeTasks.size;
    if (![...this.activeTasks.values()].some((other) => other.chunkKey === task.chunkKey))
      this.inFlightKeys.delete(task.chunkKey);
    this.options.source.releasePrepared?.(task.cx, task.cy, task.cz);
    const replacement = this.replacements.get(task.chunkKey);
    if (replacement && !this.inFlightKeys.has(task.chunkKey)) {
      this.replacements.delete(task.chunkKey);
      this.queued.set(task.chunkKey, replacement);
    }
  }

  private settleInput(taskId: number) {
    const settle = this.inputSettlements.get(taskId);
    this.inputSettlements.delete(taskId);
    settle?.();
  }

  private higherPriority(current: MeshRequestPriority | undefined, next: MeshRequestPriority): MeshRequestPriority {
    if (current === 'interactive-fluid' || next === 'interactive-fluid') return 'interactive-fluid';
    if (current === 'interactive' || next === 'interactive') return 'interactive';
    return 'streaming';
  }

  private releaseBarrierAttempt(task: PendingMeshTask) {
    const deferred = this.visibility.releaseAttempt(task);
    if (deferred) this.replacements.set(task.chunkKey, deferred);
  }

  private discard(task: PendingMeshTask, counter: string) {
    if (this.latestTasks.get(task.chunkKey)?.taskId === task.taskId && !this.replacements.has(task.chunkKey)) {
      this.latestTasks.delete(task.chunkKey);
      this.requested.delete(task.chunkKey);
    }
    this.options.telemetry.markTrace(task.traceId, counter, 'main');
    this.incrementCounter(counter);
  }

  private incrementCounter(counter: string) {
    this.options.telemetry.counter(counter, (this.options.telemetry.snapshot().gauges[counter] ?? 0) + 1);
  }
}
