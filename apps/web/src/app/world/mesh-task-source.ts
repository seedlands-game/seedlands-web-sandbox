import type { PendingMeshTask, StreamingVariant, WorkerResult } from '../app-contracts';
import type { MainSnapshot, WorkerInput } from './mesh-task-dispatch';
import { createWorkerFirstDispatch, type MeshDispatchRequest, type MeshTaskDispatch } from './mesh-task-dispatch';
import type { PerformanceTelemetry } from '../../client/presentation/performance-telemetry';
import type { PerformanceProfile } from '../../client/presentation/performance-profile';
import { recordMeshPreparationDiagnostics } from './mesh-preparation-telemetry';
import type { KernelWorldgenProviderIdentity } from '@seedlands/kernel/spatial';

type CommonMeshTaskSource = {
  seed: number;
  generatorVersion: number;
  provider?: KernelWorldgenProviderIdentity;
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

export type MeshTaskSource = CommonMeshTaskSource & {
  prepareMainSnapshot: (cx: number, cy: number, cz: number) => MainSnapshot;
  prepareWorkerInput: (cx: number, cy: number, cz: number) => WorkerInput;
  acceptWorkerCanonical: (task: PendingMeshTask, result: WorkerResult) => boolean | Promise<boolean>;
};

function prepareSourceWorkerInput(
  source: MeshTaskSource,
  cx: number,
  cy: number,
  cz: number,
): Readonly<{ input: WorkerInput }> {
  const input = source.prepareWorkerInput(cx, cy, cz);
  const provider = input.provider ?? source.provider;
  if (!provider) throw new Error('Worker mesh generation requires an explicit world-generation provider.');
  return { input: { ...input, provider } };
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
  recordMeshPreparationDiagnostics(telemetry, request.traceId, prepared.input.preparationDiagnostics);
  return { dispatch: createWorkerFirstDispatch(sequence, request, source.seed, prepared.input) };
}

export function acceptSourceMeshResult(
  source: MeshTaskSource,
  task: PendingMeshTask,
  result: WorkerResult,
): boolean | Promise<boolean> {
  return source.acceptWorkerCanonical(task, result);
}
