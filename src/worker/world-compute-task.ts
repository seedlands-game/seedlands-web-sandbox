import { batchMeshData, compactMeshData, createProceduralMeshInput, makeChunk, meshChunk } from '../world/mesh';

export type MeshTaskPayload = Readonly<{
  kind: 'mesh';
  traceId: string;
  epoch: number;
  chunkKey: string;
  seed: number;
  cx: number;
  cy: number;
  cz: number;
  chunkRevision: number;
  haloRevision: string;
  canonical: ArrayBuffer;
  halo: ArrayBuffer;
  fluid: ArrayBuffer;
  fluidHalo: ArrayBuffer;
}>;

export type GenerateMeshTaskPayload = Readonly<{
  kind: 'generate-mesh';
  traceId: string;
  epoch: number;
  chunkKey: string;
  seed: number;
  cx: number;
  cy: number;
  cz: number;
  chunkRevision: number;
  haloRevision: string;
  generatorVersion: number;
  canonical?: ArrayBuffer;
  fluid?: ArrayBuffer;
  overlays: readonly { cx: number; cy: number; cz: number; voxels: ArrayBuffer; fluid?: ArrayBuffer }[];
}>;

export type WorldComputePayload = MeshTaskPayload | GenerateMeshTaskPayload;

export class ComputeTaskCancelled extends Error {}

const resultIdentity = (task: WorldComputePayload) => ({
  traceId: task.traceId,
  epoch: task.epoch,
  chunkKey: task.chunkKey,
  seed: task.seed,
  cx: task.cx,
  cy: task.cy,
  cz: task.cz,
  chunkRevision: task.chunkRevision,
  haloRevision: task.haloRevision,
});

const packMeshes = (meshes: ReturnType<typeof meshChunk>) => batchMeshData(Object.values(meshes)).map(compactMeshData);

const checkpoint = async (isCancelled: () => boolean, yieldTurn: () => Promise<void>) => {
  await yieldTurn();
  if (isCancelled()) throw new ComputeTaskCancelled('Compute task was cancelled.');
};

export async function runWorldComputeTask(
  task: WorldComputePayload,
  isCancelled: () => boolean = () => false,
  yieldTurn: () => Promise<void> = () => Promise.resolve(),
) {
  await checkpoint(isCancelled, yieldTurn);
  if (task.kind === 'mesh') {
    const meshingStartedAt = performance.now();
    const meshes = meshChunk({
      seed: task.seed,
      cx: task.cx,
      cy: task.cy,
      cz: task.cz,
      data: new Uint16Array(task.canonical),
      changes: [],
      halo: new Uint16Array(task.halo),
      fluid: new Uint8Array(task.fluid),
      fluidHalo: new Uint8Array(task.fluidHalo),
    });
    const workerMeshingMs = performance.now() - meshingStartedAt;
    await checkpoint(isCancelled, yieldTurn);
    return { kind: 'mesh-result' as const, ...resultIdentity(task), workerMeshingMs, meshes: packMeshes(meshes) };
  }

  const generationStartedAt = performance.now();
  const canonical = task.canonical
    ? new Uint16Array(task.canonical)
    : makeChunk(task.seed, task.cx, task.cy, task.cz, [], task.generatorVersion);
  const workerGenerationMs = performance.now() - generationStartedAt;
  await checkpoint(isCancelled, yieldTurn);
  const haloStartedAt = performance.now();
  const generated = createProceduralMeshInput({
    seed: task.seed,
    generatorVersion: task.generatorVersion,
    cx: task.cx,
    cy: task.cy,
    cz: task.cz,
    canonical,
    ...(task.fluid ? { fluid: new Uint8Array(task.fluid) } : {}),
    overlays: task.overlays.map(({ voxels, fluid, ...overlay }) => ({
      ...overlay,
      voxels: new Uint16Array(voxels),
      ...(fluid ? { fluid: new Uint8Array(fluid) } : {}),
    })),
  });
  const workerHaloMs = performance.now() - haloStartedAt;
  await checkpoint(isCancelled, yieldTurn);
  const meshingStartedAt = performance.now();
  const meshes = meshChunk({
    seed: task.seed,
    cx: task.cx,
    cy: task.cy,
    cz: task.cz,
    data: generated.canonical,
    changes: [],
    halo: generated.halo,
    fluid: generated.fluid,
    fluidHalo: generated.fluidHalo,
  });
  const workerMeshingMs = performance.now() - meshingStartedAt;
  await checkpoint(isCancelled, yieldTurn);
  return {
    kind: 'mesh-result' as const,
    ...resultIdentity(task),
    generatorVersion: task.generatorVersion,
    workerGenerationMs,
    workerHaloMs,
    workerMeshingMs,
    computedHaloRevision: generated.haloRevision,
    canonical: generated.canonical.buffer,
    meshes: packMeshes(meshes),
  };
}

export function worldComputeTransfers(result: Awaited<ReturnType<typeof runWorldComputeTask>>): Transferable[] {
  const transfers: Transferable[] = [];
  result.meshes.forEach((part) =>
    transfers.push(
      part.positions.buffer,
      part.normals.buffer,
      part.uvs.buffer,
      part.colors.buffer,
      part.indices.buffer,
    ),
  );
  if ('canonical' in result) transfers.push(result.canonical);
  return transfers;
}
