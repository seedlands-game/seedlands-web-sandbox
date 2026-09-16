import { sampleWorldgenVoxel, type KernelWorldgenProvider } from '@seedlands/kernel/spatial';
import { MESH_HALO_SIZE, meshHaloIndex, type ProceduralMeshInput, type ProceduralMeshInputResult } from './mesh';
import { CHUNK_SIZE, Voxel, chunkKey, floorDiv, mod, voxelIndex } from './voxel';

export type ProviderMeshInput = Omit<ProceduralMeshInput, 'canonical' | 'generatorVersion'> &
  Readonly<{
    canonical: Uint16Array;
    generatorVersion: number;
    provider?: KernelWorldgenProvider;
  }>;

export function prepareProviderMeshInput(options: ProviderMeshInput): ProceduralMeshInputResult {
  const { seed, cx, cy, cz, canonical, generatorVersion, overlays = [] } = options;
  if (generatorVersion === undefined) throw new TypeError('Provider mesh input requires a generator version.');
  const overlayData = new Map(
    overlays.map((overlay) => [chunkKey(overlay.cx, overlay.cy, overlay.cz), overlay.voxels]),
  );
  const overlayFluid = new Map(
    overlays.map((overlay) => [chunkKey(overlay.cx, overlay.cy, overlay.cz), overlay.fluid]),
  );
  const canonicalFluid =
    options.fluid?.slice() ?? Uint8Array.from(canonical, (voxel) => (voxel === Voxel.Water ? 0x88 : 0));
  const halo = new Uint16Array(MESH_HALO_SIZE ** 3);
  const fluidHalo = new Uint8Array(MESH_HALO_SIZE ** 3);
  const sampledColumns = new Set<string>();
  let proceduralVoxelSamples = 0;
  let revision = 2166136261;
  for (let y = -1; y <= CHUNK_SIZE; y += 1)
    for (let z = -1; z <= CHUNK_SIZE; z += 1)
      for (let x = -1; x <= CHUNK_SIZE; x += 1) {
        const wx = cx * CHUNK_SIZE + x;
        const wy = cy * CHUNK_SIZE + y;
        const wz = cz * CHUNK_SIZE + z;
        const sampleCx = floorDiv(wx, CHUNK_SIZE);
        const sampleCy = floorDiv(wy, CHUNK_SIZE);
        const sampleCz = floorDiv(wz, CHUNK_SIZE);
        const local = voxelIndex(mod(wx, CHUNK_SIZE), mod(wy, CHUNK_SIZE), mod(wz, CHUNK_SIZE));
        const own = sampleCx === cx && sampleCy === cy && sampleCz === cz;
        const overlayKey = chunkKey(sampleCx, sampleCy, sampleCz);
        const overlay = overlayData.get(overlayKey);
        let value: number;
        if (own) value = canonical[local];
        else if (overlay) value = overlay[local];
        else {
          if (!options.provider)
            throw new Error('Mesh halo is incomplete and no executable world-generation provider is available.');
          value = sampleWorldgenVoxel(options.provider, { seed, generatorVersion, x: wx, y: wy, z: wz });
          proceduralVoxelSamples += 1;
          sampledColumns.add(`${wx},${wz}`);
        }
        const index = meshHaloIndex(x, y, z);
        halo[index] = value;
        const sampledFluid = own ? canonicalFluid[local] : overlayFluid.get(overlayKey)?.[local];
        fluidHalo[index] = sampledFluid ?? (value === Voxel.Water ? 0x88 : 0);
        revision = Math.imul(revision ^ value, 16777619);
      }
  return {
    canonical,
    halo,
    fluid: canonicalFluid,
    fluidHalo,
    haloRevision: String(revision >>> 0),
    proceduralVoxelSamples,
    macroContextCount: sampledColumns.size,
  };
}
