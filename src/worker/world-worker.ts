import { chunkKey } from '../world/voxel';
import { makeChunk, meshChunk, type WorldChange } from '../world/mesh';

type Task = { kind: 'chunk'; id: number; seed: number; cx: number; cy: number; cz: number; changes: WorldChange[] };

self.onmessage = (event: MessageEvent<Task>) => {
  const { id, seed, cx, cy, cz, changes } = event.data;
  const data = makeChunk(seed, cx, cy, cz, changes);
  const meshes = meshChunk({ seed, cx, cy, cz, data, changes });
  const packed = Object.values(meshes);
  const transfers: Transferable[] = [data.buffer];
  packed.forEach((part) =>
    transfers.push(
      part.positions.buffer,
      part.normals.buffer,
      part.uvs.buffer,
      part.colors.buffer,
      part.indices.buffer,
    ),
  );
  self.postMessage({ kind: 'chunk', id, key: chunkKey(cx, cy, cz), cx, cy, cz, data, meshes: packed }, transfers);
};
