import { meshChunk, type ProceduralMeshInputResult } from '../../world/mesh';
import { batchCompactMeshData } from '../../world/mesh-batching';
import { findSafePlayerSpawn } from '../gameplay/safe-spawn';
import { createStarterEcology } from '../simulation/starter-ecology';
import { findDryStarterSurface } from '../starter-surface';
import type { StarterEcologyConfiguration } from '../gameplay/actor-profile';
import {
  assertGeneratedChunk,
  sampleWorldgenVoxel,
  type KernelWorldgenProvider,
  type KernelWorldgenProviderIdentity,
  type KernelWorldgenProviderRegistry,
} from '@seedlands/kernel/spatial';
import { CHUNK_SIZE, chunkKey, floorDiv, mod, voxelIndex } from '../../world/voxel';
import { validateAuthorityCompleteMeshInput } from '../../compute/authority-complete-mesh-input';
import { prepareProviderMeshInput, type ProviderMeshInput } from '../../world/provider-mesh-input';

export { prepareProviderMeshInput } from '../../world/provider-mesh-input';
export type { ProviderMeshInput } from '../../world/provider-mesh-input';

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
  generatorVersion: number;
  provider: KernelWorldgenProviderIdentity;
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
  provider?: KernelWorldgenProviderIdentity;
  inputStrategy?: 'authority-complete';
  canonical?: ArrayBuffer;
  fluid?: ArrayBuffer;
  overlays: readonly { cx: number; cy: number; cz: number; voxels: ArrayBuffer; fluid?: ArrayBuffer }[];
}>;

export type FindSafeSpawnTaskPayload = Readonly<{
  kind: 'find-safe-spawn';
  seed: number;
  generatorVersion: number;
  provider: KernelWorldgenProviderIdentity;
  starterEcology: StarterEcologyConfiguration | null;
}>;

export type GenerateCanonicalTaskPayload = Readonly<{
  kind: 'generate-canonical';
  seed: number;
  generatorVersion: number;
  provider: KernelWorldgenProviderIdentity;
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
  provider: KernelWorldgenProviderIdentity;
  voxels: ArrayBuffer;
}>;

export type StarterCanonicalChunk = Readonly<{
  key: string;
  cx: number;
  cy: number;
  cz: number;
  chunkRevision: 0;
  generatorVersion: number;
  provider: KernelWorldgenProviderIdentity;
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
  providers: KernelWorldgenProviderRegistry;
  prepareHalo: (input: ProviderMeshInput) => ProceduralMeshInputResult;
  meshChunk: typeof meshChunk;
  packMeshes: typeof packMeshes;
  now: () => number;
}>;

const checkpoint = async (isCancelled: () => boolean, yieldTurn: () => Promise<void>) => {
  await yieldTurn();
  if (isCancelled()) throw new ComputeTaskCancelled('Compute task was cancelled.');
};

const generatedVoxels = (
  provider: KernelWorldgenProvider,
  input: Readonly<{
    seed: number;
    generatorVersion: number;
    cx: number;
    cy: number;
    cz: number;
    epoch: number;
    revision: number;
  }>,
) => {
  const expected = {
    provider: provider.identity,
    generatorVersion: input.generatorVersion,
    coordinate: { x: input.cx, y: input.cy, z: input.cz },
    epoch: input.epoch,
    revision: input.revision,
  };
  const generated = provider.generate({
    seed: input.seed,
    generatorVersion: input.generatorVersion,
    coordinate: expected.coordinate,
    epoch: input.epoch,
    revision: input.revision,
  });
  assertGeneratedChunk(expected, generated);
  return generated.voxels.slice();
};

const resolveProvider = (
  registry: KernelWorldgenProviderRegistry | undefined,
  identity: KernelWorldgenProviderIdentity | undefined,
  generatorVersion: number,
) => {
  if (!identity) throw new Error('World generation requires an explicit provider identity.');
  if (!registry) throw new Error('World generation requires a local executable provider registry.');
  return registry.resolve(identity, generatorVersion);
};

function proceduralVoxelReader(
  seed: number,
  generatorVersion: number,
  chunks: Map<string, Readonly<{ cx: number; cy: number; cz: number; voxels: Uint16Array }>>,
  provider: KernelWorldgenProvider,
) {
  return (x: number, y: number, z: number) => {
    const cx = floorDiv(x, CHUNK_SIZE);
    const cy = floorDiv(y, CHUNK_SIZE);
    const cz = floorDiv(z, CHUNK_SIZE);
    const key = chunkKey(cx, cy, cz);
    let chunk = chunks.get(key);
    if (!chunk) {
      chunk = {
        cx,
        cy,
        cz,
        voxels: generatedVoxels(provider, { seed, generatorVersion, cx, cy, cz, epoch: 0, revision: 0 }),
      };
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
  const prepareHalo = kernels.prepareHalo ?? prepareProviderMeshInput;
  const mesh = kernels.meshChunk ?? meshChunk;
  const pack = kernels.packMeshes ?? packMeshes;
  const now = kernels.now;
  await checkpoint(isCancelled, yieldTurn);
  if (task.kind === 'find-safe-spawn') {
    const provider = resolveProvider(kernels.providers, task.provider, task.generatorVersion);
    const spawnChunks = new Map<string, Readonly<{ cx: number; cy: number; cz: number; voxels: Uint16Array }>>();
    const playerBodyPosition = findSafePlayerSpawn(
      proceduralVoxelReader(task.seed, task.generatorVersion, spawnChunks, provider),
    );
    await checkpoint(isCancelled, yieldTurn);
    if (!playerBodyPosition) throw new Error('附近没有安全的干燥出生点，请尝试另一个 Seed。');
    const starterChunks = task.starterEcology
      ? new Map<string, Readonly<{ cx: number; cy: number; cz: number; voxels: Uint16Array }>>()
      : spawnChunks;
    const readStarterVoxel = proceduralVoxelReader(task.seed, task.generatorVersion, starterChunks, provider);
    if (task.starterEcology) {
      const starter = createStarterEcology(
        task.seed,
        playerBodyPosition,
        (x, z, _nearY) => findDryStarterSurface(task.seed, task.generatorVersion, x, z, readStarterVoxel),
        task.starterEcology,
      );
      for (const edit of [...starter.campEdits, ...starter.naturalEdits]) readStarterVoxel(edit.x, edit.y, edit.z);
    }
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
          provider: provider.identity,
          canonical: chunk.voxels.buffer as ArrayBuffer,
        })),
    };
    return result;
  }
  if (task.kind === 'generate-canonical') {
    const provider = resolveProvider(kernels.providers, task.provider, task.generatorVersion);
    if (task.key !== chunkKey(task.cx, task.cy, task.cz))
      throw new TypeError(`Canonical generation Chunk key is invalid: ${task.key}.`);
    const canonical = generatedVoxels(provider, {
      seed: task.seed,
      generatorVersion: task.generatorVersion,
      cx: task.cx,
      cy: task.cy,
      cz: task.cz,
      epoch: 0,
      revision: 0,
    });
    await checkpoint(isCancelled, yieldTurn);
    return {
      kind: 'canonical-result' as const,
      key: task.key,
      cx: task.cx,
      cy: task.cy,
      cz: task.cz,
      chunkRevision: 0 as const,
      generatorVersion: task.generatorVersion,
      provider: provider.identity,
      voxels: canonical.buffer as ArrayBuffer,
    } satisfies GeneratedCanonicalChunk;
  }
  if (task.kind === 'mesh') {
    const provider = resolveProvider(kernels.providers, task.provider, task.generatorVersion);
    if (!now) throw new TypeError('World mesh computation requires an explicit monotonic clock port.');
    const meshingStartedAt = now();
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
      generatorVersion: task.generatorVersion,
      outside: (x, y, z) =>
        sampleWorldgenVoxel(provider, { seed: task.seed, generatorVersion: task.generatorVersion, x, y, z }),
    });
    const workerMeshingMs = now() - meshingStartedAt;
    await checkpoint(isCancelled, yieldTurn);
    return {
      kind: 'mesh-result' as const,
      ...resultIdentity(task),
      generatorVersion: task.generatorVersion,
      provider: provider.identity,
      workerMeshingMs,
      meshes: pack(meshes),
    };
  }

  const declaredStrategy = (task as Readonly<{ inputStrategy?: unknown }>).inputStrategy;
  if (declaredStrategy !== undefined && declaredStrategy !== 'authority-complete')
    throw new TypeError('Unknown worker mesh input strategy.');
  const complete = declaredStrategy === 'authority-complete' ? validateAuthorityCompleteMeshInput(task) : undefined;
  const provider = task.provider
    ? resolveProvider(kernels.providers, task.provider, task.generatorVersion)
    : complete
      ? undefined
      : resolveProvider(kernels.providers, undefined, task.generatorVersion);
  if (!now) throw new TypeError('World mesh computation requires an explicit monotonic clock port.');
  const generationStartedAt = now();
  const canonical = complete
    ? new Uint16Array(complete.canonical)
    : task.canonical
      ? new Uint16Array(task.canonical)
      : generatedVoxels(provider!, {
          seed: task.seed,
          generatorVersion: task.generatorVersion,
          cx: task.cx,
          cy: task.cy,
          cz: task.cz,
          epoch: task.epoch,
          revision: task.chunkRevision,
        });
  const meshOverlays = (complete ?? task).overlays.map(({ voxels, fluid, ...overlay }) => ({
    ...overlay,
    voxels: new Uint16Array(voxels),
    ...(fluid ? { fluid: new Uint8Array(fluid) } : {}),
  }));
  const meshOverlayData = new Map(
    meshOverlays.map((overlay) => [chunkKey(overlay.cx, overlay.cy, overlay.cz), overlay.voxels]),
  );
  const outside = (x: number, y: number, z: number): number => {
    const outsideCx = floorDiv(x, CHUNK_SIZE);
    const outsideCy = floorDiv(y, CHUNK_SIZE);
    const outsideCz = floorDiv(z, CHUNK_SIZE);
    if (outsideCx === task.cx && outsideCy === task.cy && outsideCz === task.cz)
      return canonical[voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE))];
    const overlay = meshOverlayData.get(chunkKey(outsideCx, outsideCy, outsideCz));
    if (overlay) return overlay[voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE))];
    if (provider)
      return sampleWorldgenVoxel(provider, { seed: task.seed, generatorVersion: task.generatorVersion, x, y, z });
    throw new Error('Authority-complete mesh input does not contain the requested outside voxel.');
  };
  const workerGenerationMs = now() - generationStartedAt;
  await checkpoint(isCancelled, yieldTurn);
  const haloStartedAt = now();
  const generated = prepareHalo({
    seed: task.seed,
    generatorVersion: task.generatorVersion,
    cx: task.cx,
    cy: task.cy,
    cz: task.cz,
    canonical,
    ...(provider ? { provider } : {}),
    ...(complete ? { fluid: new Uint8Array(complete.fluid) } : task.fluid ? { fluid: new Uint8Array(task.fluid) } : {}),
    overlays: meshOverlays,
  });
  const workerHaloMs = now() - haloStartedAt;
  await checkpoint(isCancelled, yieldTurn);
  const meshingStartedAt = now();
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
    outside,
    generatorVersion: task.generatorVersion,
  });
  const workerMeshingMs = now() - meshingStartedAt;
  await checkpoint(isCancelled, yieldTurn);
  return {
    kind: 'mesh-result' as const,
    ...resultIdentity(task),
    generatorVersion: task.generatorVersion,
    ...(provider ? { provider: provider.identity } : {}),
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

export function worldComputeTransfers(result: Awaited<ReturnType<typeof runWorldComputeTask>>): ArrayBuffer[] {
  const transfers: ArrayBuffer[] = [];
  if (result.kind === 'safe-spawn-result') return result.starterChunks.map((chunk) => chunk.canonical);
  if (result.kind === 'canonical-result') return [result.voxels];
  result.meshes.forEach((part) =>
    transfers.push(
      part.positions.buffer as ArrayBuffer,
      part.normals.buffer as ArrayBuffer,
      part.uvs.buffer as ArrayBuffer,
      part.colors.buffer as ArrayBuffer,
      part.indices.buffer as ArrayBuffer,
    ),
  );
  if ('canonical' in result) transfers.push(result.canonical as ArrayBuffer);
  return transfers;
}
