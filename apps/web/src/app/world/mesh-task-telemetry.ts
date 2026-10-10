import type { PerformanceTelemetry } from '../../client/presentation/performance-telemetry';
import type { PendingMeshTask, WorkerResult } from '../app-contracts';
import type { MeshRequestPriority } from './mesh-request-priority';

type RequestDiagnostics = Readonly<{
  traceId: string;
  priority: MeshRequestPriority;
  visibilityBarrierRevision?: number;
}>;

export function recordMeshRequestMark(
  telemetry: PerformanceTelemetry,
  request: RequestDiagnostics,
  name: 'request-state' | 'prepare-start',
  state?: 'visibility-deferred' | 'replacement' | 'queued',
): void {
  telemetry.markTrace(request.traceId, name, 'main', {
    priority: request.priority,
    ...(state === undefined ? {} : { state }),
    ...(request.visibilityBarrierRevision === undefined
      ? {}
      : { visibilityBarrierRevision: request.visibilityBarrierRevision }),
  });
}

export function recordMeshCommitQueued(
  telemetry: PerformanceTelemetry,
  task: PendingMeshTask,
  partsTotal: number,
): void {
  telemetry.markTrace(task.traceId, 'commit-queued', 'main', {
    partsTotal,
    taskId: task.taskId,
    chunkRevision: task.chunkRevision,
  });
}

export function recordWorkerPreparation(
  telemetry: PerformanceTelemetry,
  task: PendingMeshTask,
  result: WorkerResult,
): void {
  if (result.workerGenerationMs !== undefined)
    telemetry.recordCompletedSpan({
      category: 'worldgen',
      name: 'WorkerGeneration',
      lane: 'worker-derived',
      durationMs: result.workerGenerationMs,
      traceId: task.traceId,
    });
  if (result.workerHaloMs !== undefined)
    telemetry.recordCompletedSpan({
      category: 'streaming',
      name: 'WorkerHaloSample',
      lane: 'worker-derived',
      durationMs: result.workerHaloMs,
      traceId: task.traceId,
    });
}
