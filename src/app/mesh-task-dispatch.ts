import { createMeshTaskSnapshot } from '../client/mesh-task-snapshot';
import type { AuthorityMeshPayload } from '../worker/authority-worker-protocol';
import type { PendingMeshTask } from './app-contracts';
import type { MeshRequestPriority } from './mesh-task-scheduler';

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

export type WorkerInput = Readonly<{
  chunkRevision: number;
  generatorVersion: number;
  canonical?: Uint16Array;
  fluid?: Uint8Array;
  overlays: WorkerOverlay[];
  preparationDiagnostics?: AuthorityMeshPayload['preparationDiagnostics'];
}>;

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
  const task: PendingMeshTask = {
    taskId: sequence,
    epoch: request.epoch,
    chunkKey: request.chunkKey,
    chunkRevision: prepared.chunkRevision,
    haloRevision: `worker-input-${sequence}`,
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
