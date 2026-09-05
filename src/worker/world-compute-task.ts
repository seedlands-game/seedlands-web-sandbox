import { batchMeshData, compactMeshData, createProceduralMeshInput, makeChunk, meshChunk } from '../world/mesh';
import { findSafePlayerSpawn } from '../server/gameplay/safe-spawn';
import { CHUNK_SIZE, chunkKey, floorDiv, mod, voxelIndex } from '../world/voxel';

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

export type FindSafeSpawnTaskPayload = Readonly<{
  kind: 'find-safe-spawn';
  seed: number;
  generatorVersion: number;
}>;

export type WorldComputePayload = MeshTaskPayload | GenerateMeshTaskPayload | FindSafeSpawnTaskPayload;

export class ComputeTaskCancelled extends Error {}

const resultIdentity = (task: MeshTaskPayload | GenerateMeshTaskPayload) => ({
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
  if (task.kind === 'find-safe-spawn') {
    const chunks = new Map<string, Uint16Array>();
    const getVoxel = (x: number, y: number, z: number) => {
      const cx = floorDiv(x, CHUNK_SIZE);
      const cy = floorDiv(y, CHUNK_SIZE);
      const cz = floorDiv(z, CHUNK_SIZE);
      const key = chunkKey(cx, cy, cz);
      let chunk = chunks.get(key);
      if (!chunk) {
        chunk = makeChunk(task.seed, cx, cy, cz, [], task.generatorVersion);
        chunks.set(key, chunk);
      }
      return chunk[voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE))];
    };
    const cameraPosition = findSafePlayerSpawn(getVoxel);
    await checkpoint(isCancelled, yieldTurn);
    if (!cameraPosition) throw new Error('附近没有安全的干燥出生点，请尝试另一个 Seed。');
    return {
      kind: 'safe-spawn-result' as const,
      position: [cameraPosition[0], cameraPosition[1] - 1.6, cameraPosition[2]] as [number, number, number],
    };
  }
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
  if (result.kind === 'safe-spawn-result') return transfers;
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
