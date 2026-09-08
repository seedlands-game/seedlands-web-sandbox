import { createMeshTaskSnapshot } from '../../client/compute/mesh-task-snapshot';
import type { AuthorityMeshPayload } from '@seedlands/game-core/compute/authority-worker-protocol';
import type { PendingMeshTask } from '../app-contracts';
import type { MeshRequestPriority } from './mesh-request-priority';

export type MeshDispatchRequest = Readonly<{
  traceId: string;
  epoch: number;
  chunkKey: string;
  cx: number;
  cy: number;
  cz: number;
  priority: MeshRequestPriority;
  visibilityBarrierRevision?: number;
}>;

export type MainSnapshot = Readonly<{
  chunkRevision: number;
  haloRevision: string;
  canonical: Uint16Array;
  halo: Uint16Array;
  fluid?: Uint8Array;
  fluidHalo?: Uint8Array;
}>;

export type WorkerOverlay = Readonly<{
  cx: number;
  cy: number;
  cz: number;
  voxels: Uint16Array;
  fluid?: Uint8Array;
}>;

export type AuthorityCompleteWorkerOverlay = Readonly<{
  cx: number;
  cy: number;
  cz: number;
  voxels: Uint16Array;
  fluid: Uint8Array;
}>;

type WorkerPreparationDiagnostics = AuthorityMeshPayload['preparationDiagnostics'];

export type AuthorityCompleteWorkerInput = Readonly<{
  inputStrategy: 'authority-complete';
  chunkRevision: number;
  generatorVersion: number;
  haloRevision: string;
  canonical: Uint16Array;
  fluid: Uint8Array;
  overlays: readonly AuthorityCompleteWorkerOverlay[];
  preparationDiagnostics?: WorkerPreparationDiagnostics;
}>;

export type WorkerInput =
  | Readonly<{
      inputStrategy?: undefined;
      chunkRevision: number;
      generatorVersion: number;
      canonical?: Uint16Array;
      fluid?: Uint8Array;
      overlays: readonly WorkerOverlay[];
      preparationDiagnostics?: WorkerPreparationDiagnostics;
    }>
  | AuthorityCompleteWorkerInput;

export type MeshTaskDispatch = Readonly<{
  task: PendingMeshTask;
  message: Record<string, unknown>;
  transfers: Transferable[];
}>;

const barrierIdentity = (request: MeshDispatchRequest) =>
  request.visibilityBarrierRevision === undefined
    ? {}
    : { visibilityBarrierRevision: request.visibilityBarrierRevision };

export function createMainSnapshotDispatch(
  sequence: number,
  request: MeshDispatchRequest,
  seed: number,
  generatorVersion: number,
  snapshot: MainSnapshot,
): MeshTaskDispatch {
  const snapshotTask = createMeshTaskSnapshot({
    taskId: sequence,
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
    seed,
    cx: request.cx,
    cy: request.cy,
    cz: request.cz,
    generatorVersion,
    variant: 'main-snapshot',
    ...barrierIdentity(request),
  };
  return {
    task,
    message: {
      kind: 'mesh',
      priority: request.priority,
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
    transfers: [
      snapshotTask.canonical.buffer,
      snapshotTask.halo.buffer,
      snapshotTask.fluid!.buffer,
      snapshotTask.fluidHalo!.buffer,
    ],
  };
}

export function createWorkerFirstDispatch(
  sequence: number,
  request: MeshDispatchRequest,
  seed: number,
  prepared: WorkerInput,
): MeshTaskDispatch {
  const strategy = (prepared as Readonly<{ inputStrategy?: unknown }>).inputStrategy;
  if (strategy !== undefined && strategy !== 'authority-complete')
    throw new TypeError('Unknown worker mesh input strategy.');
  const authorityComplete = prepared.inputStrategy === 'authority-complete';
  const task: PendingMeshTask = {
    taskId: sequence,
    epoch: request.epoch,
    chunkKey: request.chunkKey,
    chunkRevision: prepared.chunkRevision,
    haloRevision: authorityComplete ? prepared.haloRevision : `worker-input-${sequence}`,
    traceId: request.traceId,
    seed,
    cx: request.cx,
    cy: request.cy,
    cz: request.cz,
    generatorVersion: prepared.generatorVersion,
    variant: 'worker-first',
    ...barrierIdentity(request),
  };
  const transfers: Transferable[] = [];
  if (prepared.canonical) transfers.push(prepared.canonical.buffer);
  if (prepared.fluid) transfers.push(prepared.fluid.buffer);
  prepared.overlays.forEach((overlay) => {
    transfers.push(overlay.voxels.buffer);
    if (overlay.fluid) transfers.push(overlay.fluid.buffer);
  });
  return {
    task,
    message: {
      kind: 'generate-mesh',
      priority: request.priority,
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
      ...(authorityComplete ? { inputStrategy: 'authority-complete' as const } : {}),
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
  };
}
