import {
  createProceduralMeshInput,
  makeChunk,
  type ProceduralMeshInput,
  type ProceduralMeshInputResult,
} from '@seedlands/game-core/world/mesh';
import { GENERATOR_VERSION, chunkKey, voxelIndex } from '@seedlands/game-core/world/voxel';
import { columnVoxel, prepareColumns } from './chunk-kernel';
import type { KernelMemory } from './kernel-memory';

const COUNT = 34 ** 3;
const COLUMNS = 64;
const KNOWN = 32768;
const HALO = 262144;
const FLUID = 393216;

function prepare(options: ProceduralMeshInput, columns: Int32Array, known: Uint32Array) {
  const { seed, cx, cy, cz, generatorVersion = GENERATOR_VERSION, overlays = [] } = options;
  const canonical = options.canonical ?? makeChunk(seed, cx, cy, cz, [], generatorVersion);
  const fluid = options.fluid?.slice() ?? Uint8Array.from(canonical, (value) => (value === 8 ? 0x88 : 0));
  const byKey = new Map(overlays.map((overlay) => [chunkKey(overlay.cx, overlay.cy, overlay.cz), overlay]));
  let proceduralVoxelSamples = 0;
  for (let y = -1; y <= 32; y += 1)
    for (let z = -1; z <= 32; z += 1) {
      const sampleCy = cy + (y === -1 ? -1 : y === 32 ? 1 : 0);
      const sampleCz = cz + (z === -1 ? -1 : z === 32 ? 1 : 0);
      for (let segment = -1; segment <= 1; segment += 1) {
        const sampleCx = cx + segment;
        const own = sampleCx === cx && sampleCy === cy && sampleCz === cz;
        const overlay = byKey.get(chunkKey(sampleCx, sampleCy, sampleCz));
        const voxels = own ? canonical : overlay?.voxels;
        const fluids = own ? fluid : overlay?.fluid;
        const start = segment === -1 ? -1 : segment === 0 ? 0 : 32;
        const end = segment === 0 ? 31 : start;
        for (let x = start; x <= end; x += 1) {
          const output = x + 1 + 34 * (z + 1 + 34 * (y + 1));
          const local = voxelIndex((x + 32) % 32, (y + 32) % 32, (z + 32) % 32);
          if (voxels) {
            const value = voxels[local];
            known[output] = value | ((fluids?.[local] ?? (value === 8 ? 0x88 : 0)) << 16);
          } else {
            known[output] = 0xffffffff;
            proceduralVoxelSamples += 1;
          }
        }
      }
    }
  if (proceduralVoxelSamples) prepareColumns(seed, cx * 32 - 1, cz * 32 - 1, generatorVersion, columns, 40);
  return { canonical, fluid, proceduralVoxelSamples, macroContextCount: proceduralVoxelSamples ? 1600 : 0 };
}

export function createHaloStaged(options: ProceduralMeshInput): ProceduralMeshInputResult {
  const columns = new Int32Array(40 * 40 * 4);
  const known = new Uint32Array(COUNT);
  const prepared = prepare(options, columns, known);
  const halo = new Uint16Array(COUNT);
  const fluidHalo = new Uint8Array(COUNT);
  let revision = 2166136261;
  for (let y = 0; y < 34; y += 1)
    for (let z = 0; z < 34; z += 1)
      for (let x = 0; x < 34; x += 1) {
        const index = x + 34 * (z + 34 * y);
        const packed = known[index];
        const value = packed === 0xffffffff ? columnVoxel(columns, 40, x, options.cy * 32 + y - 1, z) : packed & 65535;
        halo[index] = value;
        fluidHalo[index] = packed === 0xffffffff ? (value === 8 ? 0x88 : 0) : packed >>> 16;
        revision = Math.imul(revision ^ value, 16777619);
      }
  return { ...prepared, halo, fluidHalo, haloRevision: String(revision >>> 0) };
}

export function createHaloKernel(kernel: KernelMemory): typeof createProceduralMeshInput {
  return (options) => {
    if (
      kernel.failed ||
      ![options.cx, options.cy, options.cz].every((n) => Number.isInteger(n) && Math.abs(n) < 2 ** 25)
    )
      return createProceduralMeshInput(options);
    try {
      const rawColumns = kernel.u32(COLUMNS, 40 * 40 * 4);
      const columns = new Int32Array(rawColumns.buffer, rawColumns.byteOffset, rawColumns.length);
      const prepared = prepare(options, columns, kernel.u32(KNOWN, COUNT));
      const revision = kernel.invoke('fill_halo', COLUMNS, KNOWN, HALO, FLUID, options.cy * 32 - 1) >>> 0;
      return {
        ...prepared,
        halo: kernel.u16(HALO, COUNT).slice(),
        fluidHalo: kernel.bytes(FLUID, COUNT).slice(),
        haloRevision: String(revision),
      };
    } catch {
      kernel.failed = true;
      return createProceduralMeshInput(options);
    }
  };
}
