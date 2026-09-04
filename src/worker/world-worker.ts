import { createProceduralMeshInput, makeChunk, meshChunk } from '../world/mesh';

type Identity = {
  taskId: number;
  traceId: string;
  epoch: number;
  chunkKey: string;
  seed: number;
  cx: number;
  cy: number;
  cz: number;
  chunkRevision: number;
  haloRevision: string;
};
type MeshTask = Identity & { kind: 'mesh'; canonical: ArrayBuffer; halo: ArrayBuffer };
type GenerateMeshTask = Identity & {
  kind: 'generate-mesh';
  generatorVersion: number;
  canonical?: ArrayBuffer;
  overlays: Array<{ cx: number; cy: number; cz: number; voxels: ArrayBuffer }>;
};
type Task = MeshTask | GenerateMeshTask;

const resultIdentity = ({
  taskId,
  traceId,
  epoch,
  chunkKey,
  seed,
  cx,
  cy,
  cz,
  chunkRevision,
  haloRevision,
}: Identity): Identity => ({ taskId, traceId, epoch, chunkKey, seed, cx, cy, cz, chunkRevision, haloRevision });

const packMeshes = (meshes: ReturnType<typeof meshChunk>) => {
  const packed = Object.values(meshes);
  const transfers: Transferable[] = [];
  packed.forEach((part) =>
    transfers.push(
      part.positions.buffer,
      part.normals.buffer,
      part.uvs.buffer,
      part.colors.buffer,
      part.indices.buffer,
    ),
  );
  return { packed, transfers };
};

self.onmessage = (event: MessageEvent<Task>) => {
  const task = event.data;
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
    });
    const workerMeshingMs = performance.now() - meshingStartedAt;
    const { packed, transfers } = packMeshes(meshes);
    self.postMessage({ kind: 'mesh-result', ...resultIdentity(task), workerMeshingMs, meshes: packed }, transfers);
    return;
  }

  const generationStartedAt = performance.now();
  const canonical = task.canonical
    ? new Uint16Array(task.canonical)
    : makeChunk(task.seed, task.cx, task.cy, task.cz, []);
  const workerGenerationMs = performance.now() - generationStartedAt;
  const haloStartedAt = performance.now();
  const generated = createProceduralMeshInput({
    seed: task.seed,
    cx: task.cx,
    cy: task.cy,
    cz: task.cz,
    canonical,
    overlays: task.overlays.map((overlay) => ({ ...overlay, voxels: new Uint16Array(overlay.voxels) })),
  });
  const workerHaloMs = performance.now() - haloStartedAt;
  const meshingStartedAt = performance.now();
  const meshes = meshChunk({
    seed: task.seed,
    cx: task.cx,
    cy: task.cy,
    cz: task.cz,
    data: generated.canonical,
    changes: [],
    halo: generated.halo,
  });
  const workerMeshingMs = performance.now() - meshingStartedAt;
  const { packed, transfers } = packMeshes(meshes);
  transfers.push(generated.canonical.buffer);
  self.postMessage(
    {
      kind: 'mesh-result',
      ...resultIdentity(task),
      generatorVersion: task.generatorVersion,
      workerGenerationMs,
      workerHaloMs,
      workerMeshingMs,
      computedHaloRevision: generated.haloRevision,
      canonical: generated.canonical.buffer,
      meshes: packed,
    },
    transfers,
  );
};
