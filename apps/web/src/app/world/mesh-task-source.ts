import type { PendingMeshTask, StreamingVariant, WorkerResult } from '../app-contracts';
import type { AuthorityCompleteWorkerInput, MainSnapshot, WorkerInput } from './mesh-task-dispatch';
import { createWorkerFirstDispatch, type MeshDispatchRequest, type MeshTaskDispatch } from './mesh-task-dispatch';
import type { PerformanceTelemetry } from '../../client/presentation/performance-telemetry';
import type { PerformanceProfile } from '../../client/presentation/performance-profile';
import { recordMeshPreparationDiagnostics } from './mesh-preparation-telemetry';

type CommonMeshTaskSource = {
  seed: number;
  generatorVersion: number;
  beforePrepare?: (cx: number, cy: number, cz: number) => Promise<void>;
  releasePrepared?: (cx: number, cy: number, cz: number) => void;
};

export type MeshWorkerPort = {
  onerror?: ((failure: { taskId: number; error: Error }) => void) | null;
  onmessage: ((event: MessageEvent<WorkerResult>) => void) | null;
  postMessage: (message: Record<string, unknown>, transfer: Transferable[]) => void;
  terminate: () => void;
};

export type MeshTaskSchedulerOptions = {
  worker: MeshWorkerPort;
  source: MeshTaskSource;
  telemetry: PerformanceTelemetry;
  profile: PerformanceProfile;
  variant: StreamingVariant;
  onAcceptedResult: (task: PendingMeshTask, result: WorkerResult) => void;
};

export type CompleteWorkerInputLease = Readonly<{
  input: AuthorityCompleteWorkerInput;
  settle(): void;
}>;

export type MeshTaskSource = CommonMeshTaskSource &
  (
    | {
        kind?: 'integrated';
        prepareMainSnapshot: (cx: number, cy: number, cz: number) => MainSnapshot;
        prepareWorkerInput: (cx: number, cy: number, cz: number) => WorkerInput;
        acceptWorkerCanonical: (task: PendingMeshTask, result: WorkerResult) => boolean | Promise<boolean>;
        prepareCompleteWorkerInput?: never;
        acceptDerivedMesh?: never;
      }
    | {
        kind: 'authority-complete';
        prepareCompleteWorkerInput: (cx: number, cy: number, cz: number) => CompleteWorkerInputLease;
        acceptDerivedMesh: (task: PendingMeshTask, result: WorkerResult) => boolean | Promise<boolean>;
        prepareMainSnapshot?: never;
        prepareWorkerInput?: never;
        acceptWorkerCanonical?: never;
        releasePrepared?: never;
      }
  );

export function assertMeshSourceVariant(source: MeshTaskSource, variant: StreamingVariant): void {
  if (source.kind === 'authority-complete' && variant !== 'worker-first')
    throw new TypeError('Complete Authority input requires the worker-first mesh path.');
}

function prepareSourceWorkerInput(
  source: MeshTaskSource,
  cx: number,
  cy: number,
  cz: number,
): Readonly<{ input: WorkerInput; settle?: () => void }> {
  if (source.kind !== 'authority-complete') return { input: source.prepareWorkerInput(cx, cy, cz) };
  const lease = source.prepareCompleteWorkerInput(cx, cy, cz);
  try {
    if (!lease || lease.input?.inputStrategy !== 'authority-complete' || typeof lease.settle !== 'function')
      throw new TypeError('Complete mesh source did not provide complete input and a settlement lease.');
    return { input: lease.input, settle: () => lease.settle() };
  } catch (error) {
    lease?.settle?.();
    throw error;
  }
}

export function prepareSourceWorkerDispatch(
  source: MeshTaskSource,
  request: MeshDispatchRequest,
  sequence: number,
  telemetry: PerformanceTelemetry,
): Readonly<{ dispatch: MeshTaskDispatch; settle?: () => void }> {
  const span = telemetry.beginSpan('streaming', 'AuthorityOverlayCopy', 'main', request.traceId);
  let prepared: ReturnType<typeof prepareSourceWorkerInput>;
  try {
    prepared = prepareSourceWorkerInput(source, request.cx, request.cy, request.cz);
  } finally {
    telemetry.endSpan(span);
  }
  try {
    recordMeshPreparationDiagnostics(telemetry, request.traceId, prepared.input.preparationDiagnostics);
    return {
      dispatch: createWorkerFirstDispatch(sequence, request, source.seed, prepared.input),
      ...(prepared.settle ? { settle: prepared.settle } : {}),
    };
  } catch (error) {
    prepared.settle?.();
    throw error;
  }
}

export function acceptSourceMeshResult(
  source: MeshTaskSource,
  task: PendingMeshTask,
  result: WorkerResult,
): boolean | Promise<boolean> {
  if (source.kind !== 'authority-complete') return source.acceptWorkerCanonical(task, result);
  if (result.authorityComplete !== true || result.proceduralVoxelSamples !== 0 || result.macroContextCount !== 0)
    return false;
  return source.acceptDerivedMesh(task, result);
}
