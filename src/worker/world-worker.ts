import { meshChunk } from '../world/mesh';

type Task = {
  kind: 'mesh';
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
  canonical: ArrayBuffer;
  halo: ArrayBuffer;
};

self.onmessage = (event: MessageEvent<Task>) => {
  const { taskId, traceId, epoch, chunkKey, seed, cx, cy, cz, chunkRevision, haloRevision, canonical, halo } =
    event.data;
  const meshingStartedAt = performance.now();
  const meshes = meshChunk({
    seed,
    cx,
    cy,
    cz,
    data: new Uint16Array(canonical),
    changes: [],
    halo: new Uint16Array(halo),
  });
  const workerMeshingMs = performance.now() - meshingStartedAt;
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
  self.postMessage(
    {
      kind: 'mesh-result',
      taskId,
      traceId,
      epoch,
      chunkKey,
      cx,
      cy,
      cz,
      chunkRevision,
      haloRevision,
      workerMeshingMs,
      meshes: packed,
    },
    transfers,
  );
};
