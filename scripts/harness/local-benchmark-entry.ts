import { makeChunk, meshChunk } from '@seedlands/stdlib/world/mesh';
import { normalizeSeed } from '@seedlands/stdlib/world/voxel';

// Keep the pre-migration Harness's seed and 7 x 5 chunk workload.
export function meshSample() {
  const seed = normalizeSeed('seedlands-harness-benchmark-v1');
  const coordinates = [-3, -2, -1, 0, 1, 2, 3].flatMap((x) => [-2, -1, 0, 1, 2].map((z) => [x, 0, z] as const));
  let meshBytes = 0;
  let vertices = 0;
  const preparationStarted = performance.now();
  const inputs = coordinates.map(([cx, cy, cz]) => ({ cx, cy, cz, data: makeChunk(seed, cx, cy, cz, []) }));
  const preparationMs = performance.now() - preparationStarted;
  const kernelStarted = performance.now();
  for (const input of inputs) {
    const meshes = meshChunk({ seed, ...input, changes: [] });
    for (const mesh of Object.values(meshes)) {
      meshBytes += mesh.positions.byteLength + mesh.normals.byteLength + mesh.uvs.byteLength + mesh.indices.byteLength;
      vertices += mesh.positions.length / 3;
    }
  }
  const kernelMs = performance.now() - kernelStarted;
  return { preparationMs, kernelMs, totalMs: preparationMs + kernelMs, chunks: inputs.length, meshBytes, vertices };
}
