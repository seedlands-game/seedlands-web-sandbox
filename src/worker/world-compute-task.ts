import { createProceduralMeshInput, makeChunk, meshChunk } from '../world/mesh';
import { batchCompactMeshData } from '../world/mesh-batching';
import { findSafePlayerSpawn } from '../server/gameplay/safe-spawn';
import { createStarterEcology } from '../server/simulation/starter-ecology';
import { findDryStarterSurface } from '../server/starter-surface';
import { CHUNK_SIZE, chunkKey, floorDiv, mod, voxelIndex } from '../world/voxel';
import { validateAuthorityCompleteMeshInput } from './authority-complete-mesh-input';

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
  inputStrategy?: 'authority-complete';
  canonical?: ArrayBuffer;
  fluid?: ArrayBuffer;
  overlays: readonly { cx: number; cy: number; cz: number; voxels: ArrayBuffer; fluid?: ArrayBuffer }[];
}>;

export type FindSafeSpawnTaskPayload = Readonly<{
  kind: 'find-safe-spawn';
  seed: number;
  generatorVersion: number;
}>;

export type GenerateCanonicalTaskPayload = Readonly<{
  kind: 'generate-canonical';
  seed: number;
  generatorVersion: number;
  key: string;
  cx: number;
  cy: number;
  cz: number;
}>;

export type GeneratedCanonicalChunk = Readonly<{
  kind: 'canonical-result';
  key: string;
  cx: number;
  cy: number;
  cz: number;
  chunkRevision: 0;
  generatorVersion: number;
  voxels: ArrayBuffer;
}>;

export type StarterCanonicalChunk = Readonly<{
  key: string;
  cx: number;
  cy: number;
  cz: number;
  chunkRevision: 0;
  generatorVersion: number;
  canonical: ArrayBuffer;
}>;

export type InitialWorldBootstrap = Readonly<{
  kind: 'safe-spawn-result';
  playerBodyPosition: [number, number, number];
  starterChunks: readonly StarterCanonicalChunk[];
}>;

export type WorldComputePayload =
  MeshTaskPayload | GenerateMeshTaskPayload | FindSafeSpawnTaskPayload | GenerateCanonicalTaskPayload;

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

const packMeshes = (meshes: ReturnType<typeof meshChunk>) => batchCompactMeshData(Object.values(meshes));

export type WorldComputeKernels = Partial<{
  makeChunk: typeof makeChunk;
  prepareHalo: typeof createProceduralMeshInput;
  meshChunk: typeof meshChunk;
  packMeshes: typeof packMeshes;
}>;

const checkpoint = async (isCancelled: () => boolean, yieldTurn: () => Promise<void>) => {
  await yieldTurn();
  if (isCancelled()) throw new ComputeTaskCancelled('Compute task was cancelled.');
};

function proceduralVoxelReader(
  seed: number,
  generatorVersion: number,
  chunks: Map<string, Readonly<{ cx: number; cy: number; cz: number; voxels: Uint16Array }>>,
  generate = makeChunk,
) {
  return (x: number, y: number, z: number) => {
    const cx = floorDiv(x, CHUNK_SIZE);
    const cy = floorDiv(y, CHUNK_SIZE);
    const cz = floorDiv(z, CHUNK_SIZE);
    const key = chunkKey(cx, cy, cz);
    let chunk = chunks.get(key);
    if (!chunk) {
      chunk = { cx, cy, cz, voxels: generate(seed, cx, cy, cz, [], generatorVersion) };
      chunks.set(key, chunk);
    }
    return chunk.voxels[voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE))];
  };
}

export async function runWorldComputeTask(
  task: WorldComputePayload,
  isCancelled: () => boolean = () => false,
  yieldTurn: () => Promise<void> = () => Promise.resolve(),
  kernels: WorldComputeKernels = {},
) {
  const generate = kernels.makeChunk ?? makeChunk;
  const prepareHalo = kernels.prepareHalo ?? createProceduralMeshInput;
  const mesh = kernels.meshChunk ?? meshChunk;
  const pack = kernels.packMeshes ?? packMeshes;
  await checkpoint(isCancelled, yieldTurn);
  if (task.kind === 'find-safe-spawn') {
    const spawnChunks = new Map<string, Readonly<{ cx: number; cy: number; cz: number; voxels: Uint16Array }>>();
    const playerBodyPosition = findSafePlayerSpawn(
      proceduralVoxelReader(task.seed, task.generatorVersion, spawnChunks, generate),
    );
    await checkpoint(isCancelled, yieldTurn);
    if (!playerBodyPosition) throw new Error('附近没有安全的干燥出生点，请尝试另一个 Seed。');
    const starterChunks = new Map<string, Readonly<{ cx: number; cy: number; cz: number; voxels: Uint16Array }>>();
    const readStarterVoxel = proceduralVoxelReader(task.seed, task.generatorVersion, starterChunks, generate);
    const starter = createStarterEcology(task.seed, playerBodyPosition, (x, z, _nearY) =>
      findDryStarterSurface(task.seed, task.generatorVersion, x, z, readStarterVoxel),
    );
    for (const edit of [...starter.campEdits, ...starter.naturalEdits]) readStarterVoxel(edit.x, edit.y, edit.z);
    await checkpoint(isCancelled, yieldTurn);
    const result: InitialWorldBootstrap = {
      kind: 'safe-spawn-result' as const,
      playerBodyPosition,
      starterChunks: [...starterChunks.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, chunk]) => ({
          key,
          cx: chunk.cx,
          cy: chunk.cy,
          cz: chunk.cz,
          chunkRevision: 0,
          generatorVersion: task.generatorVersion,
          canonical: chunk.voxels.buffer as ArrayBuffer,
        })),
    };
    return result;
  }
  if (task.kind === 'generate-canonical') {
    if (task.key !== chunkKey(task.cx, task.cy, task.cz))
      throw new TypeError(`Canonical generation Chunk key is invalid: ${task.key}.`);
    const canonical = generate(task.seed, task.cx, task.cy, task.cz, [], task.generatorVersion);
    await checkpoint(isCancelled, yieldTurn);
    return {
      kind: 'canonical-result' as const,
      key: task.key,
      cx: task.cx,
      cy: task.cy,
      cz: task.cz,
      chunkRevision: 0 as const,
      generatorVersion: task.generatorVersion,
      voxels: canonical.buffer as ArrayBuffer,
    } satisfies GeneratedCanonicalChunk;
  }
  if (task.kind === 'mesh') {
    const meshingStartedAt = performance.now();
    const meshes = mesh({
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
    return { kind: 'mesh-result' as const, ...resultIdentity(task), workerMeshingMs, meshes: pack(meshes) };
  }

  const declaredStrategy = (task as Readonly<{ inputStrategy?: unknown }>).inputStrategy;
  if (declaredStrategy !== undefined && declaredStrategy !== 'authority-complete')
    throw new TypeError('Unknown worker mesh input strategy.');
  const complete = declaredStrategy === 'authority-complete' ? validateAuthorityCompleteMeshInput(task) : undefined;
  const generationStartedAt = performance.now();
  const canonical = complete
    ? new Uint16Array(complete.canonical)
    : task.canonical
      ? new Uint16Array(task.canonical)
      : generate(task.seed, task.cx, task.cy, task.cz, [], task.generatorVersion);
  const workerGenerationMs = performance.now() - generationStartedAt;
  await checkpoint(isCancelled, yieldTurn);
  const haloStartedAt = performance.now();
  const generated = prepareHalo({
    seed: task.seed,
    generatorVersion: task.generatorVersion,
    cx: task.cx,
    cy: task.cy,
    cz: task.cz,
    canonical,
    ...(complete ? { fluid: new Uint8Array(complete.fluid) } : task.fluid ? { fluid: new Uint8Array(task.fluid) } : {}),
    overlays: (complete ?? task).overlays.map(({ voxels, fluid, ...overlay }) => ({
      ...overlay,
      voxels: new Uint16Array(voxels),
      ...(fluid ? { fluid: new Uint8Array(fluid) } : {}),
    })),
  });
  const workerHaloMs = performance.now() - haloStartedAt;
  await checkpoint(isCancelled, yieldTurn);
  const meshingStartedAt = performance.now();
  const meshes = mesh({
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
    ...(complete
      ? {
          authorityComplete: true as const,
          proceduralVoxelSamples: generated.proceduralVoxelSamples,
          macroContextCount: generated.macroContextCount,
        }
      : {}),
    canonical: generated.canonical.buffer,
    meshes: pack(meshes),
  };
}

export function worldComputeTransfers(result: Awaited<ReturnType<typeof runWorldComputeTask>>): Transferable[] {
  const transfers: Transferable[] = [];
  if (result.kind === 'safe-spawn-result') return result.starterChunks.map((chunk) => chunk.canonical);
  if (result.kind === 'canonical-result') return [result.voxels];
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
