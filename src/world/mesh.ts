import {
  CHUNK_SIZE,
  GENERATOR_VERSION,
  Voxel,
  baseVoxel,
  chunkKey,
  faceMaterialFor,
  mod,
  voxelIndex,
  type FaceMaterialId,
} from './voxel';
import { macroAt, type MacroContext } from './macro-world';
import { sameMeshMaskCell, type MeshMaskCell } from './mesh-mask';
import { shapeWaterFace, waterStepFace, waterSurfaceHeight } from './water-mesh-height';
import { makeChunk, type WorldChange } from './chunk-generation';
import { modelBoxesForVoxel, voxelOccludesFullFace } from './voxel-model';
import { renderCategoryForMaterial, type RenderCategory } from './mesh-render-category';
import { forEachVoxelModelFace } from './voxel-model-mesh';

export type { RenderCategory } from './mesh-render-category';

export { makeChunk } from './chunk-generation';
export type { WorldChange } from './chunk-generation';
export type VertexLayout = 'float32' | 'compact';
export const MESH_HALO_SIZE = CHUNK_SIZE + 2;
export const meshHaloIndex = (x: number, y: number, z: number) =>
  x + 1 + MESH_HALO_SIZE * (z + 1 + MESH_HALO_SIZE * (y + 1));
export type MeshData = {
  material: FaceMaterialId | null;
  renderCategory: RenderCategory;
  layout: VertexLayout;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | Uint16Array;
  colors: Uint8Array;
  indices: Uint32Array | Uint16Array;
};
type Quad = { p: number[]; n: number[]; uv: number[]; c: number[]; i: number[] };
export type MeshOptions = {
  seed: number;
  cx: number;
  cy: number;
  cz: number;
  data: Uint16Array;
  changes: WorldChange[];
  halo?: Uint16Array;
  fluid?: Uint8Array;
  fluidHalo?: Uint8Array;
  outside?: (x: number, y: number, z: number) => number;
  generatorVersion?: number;
};
export type MeshAuthorityOverlay = {
  cx: number;
  cy: number;
  cz: number;
  voxels: Uint16Array;
  fluid?: Uint8Array;
};
export type ProceduralMeshInput = {
  seed: number;
  cx: number;
  cy: number;
  cz: number;
  canonical?: Uint16Array;
  overlays?: readonly MeshAuthorityOverlay[];
  fluid?: Uint8Array;
  generatorVersion?: number;
};
export type ProceduralMeshInputResult = {
  canonical: Uint16Array;
  halo: Uint16Array;
  fluid: Uint8Array;
  fluidHalo: Uint8Array;
  haloRevision: string;
  proceduralVoxelSamples: number;
  macroContextCount: number;
};

const AO_BRIGHTNESS = [255, 220, 190, 160] as const;
const FRONT_CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;
const BACK_CORNERS = [
  [-1, -1],
  [-1, 1],
  [1, 1],
  [1, -1],
] as const;

export function createProceduralMeshInput({
  seed,
  cx,
  cy,
  cz,
  generatorVersion = GENERATOR_VERSION,
  canonical = makeChunk(seed, cx, cy, cz, [], generatorVersion),
  overlays = [],
  fluid,
}: ProceduralMeshInput): ProceduralMeshInputResult {
  const overlayData = new Map(
    overlays.map((overlay) => [chunkKey(overlay.cx, overlay.cy, overlay.cz), overlay.voxels]),
  );
  const overlayFluid = new Map(
    overlays.map((overlay) => [chunkKey(overlay.cx, overlay.cy, overlay.cz), overlay.fluid]),
  );
  const macroContexts = new Map<string, MacroContext>();
  let proceduralVoxelSamples = 0;
  const queryMacro = (x: number, z: number) => {
    const key = `${x},${z}`;
    let context = macroContexts.get(key);
    if (!context) {
      context = macroAt(seed, x, z, generatorVersion);
      macroContexts.set(key, context);
    }
    return context;
  };
  const sample = (x: number, y: number, z: number) => {
    const sampleCx = Math.floor(x / CHUNK_SIZE);
    const sampleCy = Math.floor(y / CHUNK_SIZE);
    const sampleCz = Math.floor(z / CHUNK_SIZE);
    if (sampleCx === cx && sampleCy === cy && sampleCz === cz)
      return canonical[voxelIndex(x - cx * CHUNK_SIZE, y - cy * CHUNK_SIZE, z - cz * CHUNK_SIZE)];
    const source = overlayData.get(chunkKey(sampleCx, sampleCy, sampleCz));
    if (source)
      return source[
        voxelIndex(
          ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
          ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
          ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
        )
      ];
    proceduralVoxelSamples += 1;
    return baseVoxel(seed, x, y, z, queryMacro(x, z), queryMacro);
  };
  const halo = new Uint16Array(MESH_HALO_SIZE ** 3);
  const canonicalFluid = fluid?.slice() ?? Uint8Array.from(canonical, (voxel) => (voxel === Voxel.Water ? 0x88 : 0));
  const fluidHalo = new Uint8Array(MESH_HALO_SIZE ** 3);
  let revision = 2166136261;
  for (let y = -1; y <= CHUNK_SIZE; y += 1)
    for (let z = -1; z <= CHUNK_SIZE; z += 1)
      for (let x = -1; x <= CHUNK_SIZE; x += 1) {
        const value = sample(cx * CHUNK_SIZE + x, cy * CHUNK_SIZE + y, cz * CHUNK_SIZE + z);
        halo[meshHaloIndex(x, y, z)] = value;
        const wx = cx * CHUNK_SIZE + x;
        const wy = cy * CHUNK_SIZE + y;
        const wz = cz * CHUNK_SIZE + z;
        const sampleCx = Math.floor(wx / CHUNK_SIZE);
        const sampleCy = Math.floor(wy / CHUNK_SIZE);
        const sampleCz = Math.floor(wz / CHUNK_SIZE);
        const localIndex = voxelIndex(mod(wx, CHUNK_SIZE), mod(wy, CHUNK_SIZE), mod(wz, CHUNK_SIZE));
        const sampledFluid =
          sampleCx === cx && sampleCy === cy && sampleCz === cz
            ? canonicalFluid[localIndex]
            : overlayFluid.get(chunkKey(sampleCx, sampleCy, sampleCz))?.[localIndex];
        fluidHalo[meshHaloIndex(x, y, z)] = sampledFluid ?? (value === Voxel.Water ? 0x88 : 0);
        revision = Math.imul(revision ^ value, 16777619);
      }
  return {
    canonical,
    halo,
    fluid: canonicalFluid,
    fluidHalo,
    haloRevision: `${revision >>> 0}`,
    proceduralVoxelSamples,
    macroContextCount: macroContexts.size,
  };
}

const isGreedyVoxel = (voxel: number) => voxel !== Voxel.Air && modelBoxesForVoxel(voxel).length === 0;
const isVisibleFace = (source: number, target: number) =>
  isGreedyVoxel(source) &&
  (source === Voxel.Water
    ? target === Voxel.Air || (target !== Voxel.Water && !voxelOccludesFullFace(target))
    : target === Voxel.Air || target === Voxel.Water || !voxelOccludesFullFace(target));

function vertexAo(
  block: readonly number[],
  normalAxis: number,
  u: number,
  v: number,
  back: boolean,
  sample: (x: number, y: number, z: number) => number,
): readonly [number, number, number, number] {
  const normal = back ? -1 : 1;
  const outside = [...block];
  outside[normalAxis] += normal;
  const corners = back ? BACK_CORNERS : FRONT_CORNERS;
  const values = corners.map(([su, sv]) => {
    const sideU = [...outside];
    sideU[u] += su;
    const sideV = [...outside];
    sideV[v] += sv;
    const corner = [...outside];
    corner[u] += su;
    corner[v] += sv;
    const occupiedU = voxelOccludesFullFace(sample(sideU[0], sideU[1], sideU[2]));
    const occupiedV = voxelOccludesFullFace(sample(sideV[0], sideV[1], sideV[2]));
    if (occupiedU && occupiedV) return 3;
    return (
      Number(occupiedU) + Number(occupiedV) + Number(voxelOccludesFullFace(sample(corner[0], corner[1], corner[2])))
    );
  });
  return values as unknown as readonly [number, number, number, number];
}

export function meshChunk({
  seed,
  cx,
  cy,
  cz,
  data,
  changes,
  outside,
  halo,
  fluid,
  fluidHalo,
  generatorVersion = GENERATOR_VERSION,
}: MeshOptions): Record<number, MeshData> {
  const result: Record<number, Quad> = {};
  const overrides = new Map(changes.map(([x, y, z, value]) => [`${x},${y},${z}`, value]));
  const macroCache = new Map<string, MacroContext>();
  const queryMacro = (x: number, z: number) => {
    const key = chunkKey(x, 0, z);
    let context = macroCache.get(key);
    if (!context) {
      context = macroAt(seed, x, z, generatorVersion);
      macroCache.set(key, context);
    }
    return context;
  };
  const sample = (x: number, y: number, z: number): number => {
    if (x >= 0 && y >= 0 && z >= 0 && x < CHUNK_SIZE && y < CHUNK_SIZE && z < CHUNK_SIZE)
      return data[voxelIndex(x, y, z)];
    const wx = cx * CHUNK_SIZE + x,
      wy = cy * CHUNK_SIZE + y,
      wz = cz * CHUNK_SIZE + z;
    if (halo && x >= -1 && y >= -1 && z >= -1 && x <= CHUNK_SIZE && y <= CHUNK_SIZE && z <= CHUNK_SIZE)
      return halo[meshHaloIndex(x, y, z)];
    return (
      overrides.get(`${wx},${wy},${wz}`) ??
      outside?.(wx, wy, wz) ??
      baseVoxel(seed, wx, wy, wz, queryMacro(wx, wz), queryMacro)
    );
  };
  const sampleFluid = (x: number, y: number, z: number): number => {
    if (x >= 0 && y >= 0 && z >= 0 && x < CHUNK_SIZE && y < CHUNK_SIZE && z < CHUNK_SIZE)
      return fluid?.[voxelIndex(x, y, z)] ?? (data[voxelIndex(x, y, z)] === Voxel.Water ? 0x88 : 0);
    if (fluidHalo && x >= -1 && y >= -1 && z >= -1 && x <= CHUNK_SIZE && y <= CHUNK_SIZE && z <= CHUNK_SIZE)
      return fluidHalo[meshHaloIndex(x, y, z)];
    return sample(x, y, z) === Voxel.Water ? 0x88 : 0;
  };
  const fluidSurfaceAt = (x: number, y: number, z: number) =>
    waterSurfaceHeight(Math.max(1, sampleFluid(x, y, z) & 0x0f), sample(x, y + 1, z) === Voxel.Water);
  const add = (
    material: FaceMaterialId,
    vertices: number[],
    normal: number[],
    normalAxis: number,
    width: number,
    height: number,
    back: boolean,
    ao: readonly number[],
    fluidLevel: number,
    fluidFloorHeight: number,
  ) => {
    const quad = (result[material] ??= { p: [], n: [], uv: [], c: [], i: [] });
    const start = quad.p.length / 3;
    shapeWaterFace(material, normalAxis, back, fluidLevel, fluidFloorHeight, vertices);
    quad.p.push(...vertices);
    quad.n.push(...normal, ...normal, ...normal, ...normal);
    if (normalAxis === 0) {
      // X-facing quads are built Y-first. Swap their UV axes so world Y always
      // maps to texture V, matching Z-facing quads and keeping side textures upright.
      quad.uv.push(...(back ? [0, 0, height, 0, height, width, 0, width] : [0, 0, 0, width, height, width, height, 0]));
    } else {
      quad.uv.push(...(back ? [0, 0, 0, height, width, height, width, 0] : [0, 0, width, 0, width, height, 0, height]));
    }
    for (const level of ao) {
      const brightness = AO_BRIGHTNESS[level];
      quad.c.push(brightness, brightness, brightness, 255);
    }
    if (ao[0] + ao[2] > ao[1] + ao[3]) quad.i.push(start, start + 1, start + 3, start + 1, start + 2, start + 3);
    else quad.i.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };
  for (let d = 0; d < 3; d += 1) {
    const u = (d + 1) % 3,
      v = (d + 2) % 3;
    const x = [0, 0, 0];
    const q = [0, 0, 0];
    q[d] = 1;
    const mask: (MeshMaskCell | null)[] = new Array(CHUNK_SIZE * CHUNK_SIZE);
    for (x[d] = -1; x[d] < CHUNK_SIZE;) {
      let m = 0;
      for (x[v] = 0; x[v] < CHUNK_SIZE; x[v] += 1)
        for (x[u] = 0; x[u] < CHUNK_SIZE; x[u] += 1) {
          const a = sample(x[0], x[1], x[2]);
          const b = sample(x[0] + q[0], x[1] + q[1], x[2] + q[2]);
          const aHeight = a === Voxel.Water ? fluidSurfaceAt(x[0], x[1], x[2]) : 0;
          const bHeight = b === Voxel.Water ? fluidSurfaceAt(x[0] + q[0], x[1] + q[1], x[2] + q[2]) : 0;
          const step = waterStepFace(d, a, b, aHeight, bHeight);
          const forward = step?.forward ?? isVisibleFace(a, b);
          const back = step?.back ?? (!forward && isVisibleFace(b, a));
          if (!forward && !back) {
            mask[m++] = null;
            continue;
          }
          const id = back ? b : a;
          const block = [...x];
          if (back) block[d] += 1;
          const material = faceMaterialFor(id, d, !back);
          mask[m++] = {
            material,
            renderCategory: renderCategoryForMaterial(material),
            back,
            ao: id === Voxel.Water ? [0, 0, 0, 0] : vertexAo(block, d, u, v, back, sample),
            fluidLevel: id === Voxel.Water ? (step?.high ?? (back ? bHeight : aHeight)) : 0,
            fluidFloorHeight: step?.low ?? 0,
          };
        }
      x[d] += 1;
      m = 0;
      for (let j = 0; j < CHUNK_SIZE; j += 1)
        for (let i = 0; i < CHUNK_SIZE;) {
          const cell = mask[m];
          if (!cell) {
            i += 1;
            m += 1;
            continue;
          }
          let width = 1;
          while (i + width < CHUNK_SIZE && sameMeshMaskCell(mask[m + width], cell)) width += 1;
          let height = 1;
          outer: for (; j + height < CHUNK_SIZE; height += 1)
            for (let offset = 0; offset < width; offset += 1)
              if (!sameMeshMaskCell(mask[m + offset + height * CHUNK_SIZE], cell)) break outer;
          x[u] = i;
          x[v] = j;
          const du = [0, 0, 0];
          const dv = [0, 0, 0];
          du[u] = width;
          dv[v] = height;
          const p = [x[0], x[1], x[2]];
          const p1 = [x[0] + du[0], x[1] + du[1], x[2] + du[2]];
          const p2 = [x[0] + du[0] + dv[0], x[1] + du[1] + dv[1], x[2] + du[2] + dv[2]];
          const p3 = [x[0] + dv[0], x[1] + dv[1], x[2] + dv[2]];
          const normal = [0, 0, 0];
          normal[d] = cell.back ? -1 : 1;
          add(
            cell.material,
            cell.back ? [...p, ...p3, ...p2, ...p1] : [...p, ...p1, ...p2, ...p3],
            normal,
            d,
            width,
            height,
            cell.back,
            cell.ao,
            cell.fluidLevel,
            cell.fluidFloorHeight,
          );
          for (let row = 0; row < height; row += 1)
            for (let column = 0; column < width; column += 1) mask[m + column + row * CHUNK_SIZE] = null;
          i += width;
          m += width;
        }
    }
  }
  forEachVoxelModelFace(data, (face) =>
    add(
      face.material,
      face.positions,
      face.normal,
      face.dimension,
      face.width,
      face.height,
      face.back,
      [0, 0, 0, 0],
      0,
      0,
    ),
  );
  return Object.fromEntries(
    Object.entries(result).map(([material, value]) => {
      const materialId = Number(material) as FaceMaterialId;
      return [
        materialId,
        {
          material: materialId,
          renderCategory: renderCategoryForMaterial(materialId),
          layout: 'float32',
          positions: new Float32Array(value.p),
          normals: new Float32Array(value.n),
          uvs: new Float32Array(value.uv),
          colors: new Uint8Array(value.c),
          indices: new Uint32Array(value.i),
        },
      ];
    }),
  );
}

export const meshDataByteLength = (mesh: MeshData) =>
  mesh.positions.byteLength +
  mesh.normals.byteLength +
  mesh.uvs.byteLength +
  mesh.colors.byteLength +
  mesh.indices.byteLength;

export function batchMeshData(parts: readonly MeshData[]): MeshData[] {
  const categories: RenderCategory[] = ['opaque', 'cutout', 'emissive', 'transparent'];
  return categories.flatMap((renderCategory) => {
    const matching = parts.filter((part) => part.renderCategory === renderCategory);
    if (!matching.length) return [];
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    for (const part of matching) {
      if (part.layout !== 'float32' || part.material === null)
        throw new Error('Render-category batching expects unbatched Float32 mesh parts.');
      const vertexOffset = positions.length / 3;
      positions.push(...part.positions);
      normals.push(...part.normals);
      uvs.push(...part.uvs);
      for (let index = 0; index < part.colors.length; index += 4)
        colors.push(part.colors[index], part.colors[index + 1], part.colors[index + 2], part.material - 1);
      for (const index of part.indices) indices.push(index + vertexOffset);
    }
    return [
      {
        material: null,
        renderCategory,
        layout: 'float32' as const,
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        colors: new Uint8Array(colors),
        indices: new Uint32Array(indices),
      },
    ];
  });
}

export function compactMeshData(mesh: MeshData): MeshData {
  if (mesh.layout !== 'float32') return mesh;
  const maxIndex = mesh.indices.length ? Math.max(...mesh.indices) : 0;
  return {
    ...mesh,
    layout: 'compact',
    positions: new Float32Array(mesh.positions),
    normals: new Float32Array(mesh.normals),
    uvs: Uint16Array.from(mesh.uvs, float32ToFloat16),
    indices: maxIndex <= 65_535 ? new Uint16Array(mesh.indices) : new Uint32Array(mesh.indices),
  };
}

export function decodeCompactMeshData(mesh: MeshData): MeshData {
  if (mesh.layout !== 'compact') return mesh;
  return {
    ...mesh,
    layout: 'float32',
    positions: new Float32Array(mesh.positions),
    normals: new Float32Array(mesh.normals),
    uvs: Float32Array.from(mesh.uvs, float16ToFloat32),
    indices: new Uint32Array(mesh.indices),
  };
}

function float32ToFloat16(value: number) {
  const bits = new Uint32Array(new Float32Array([value]).buffer)[0];
  const sign = (bits >>> 16) & 0x8000;
  const exponent = ((bits >>> 23) & 0xff) - 127 + 15;
  const mantissa = bits & 0x7fffff;
  if (exponent <= 0) return sign;
  if (exponent >= 31) return sign | 0x7c00;
  return sign | (exponent << 10) | (mantissa >>> 13);
}

function float16ToFloat32(value: number) {
  const sign = (value & 0x8000) << 16;
  let exponent = (value >>> 10) & 0x1f;
  let mantissa = value & 0x3ff;
  if (exponent === 0) {
    if (mantissa === 0) return new Float32Array(new Uint32Array([sign]).buffer)[0];
    while ((mantissa & 0x400) === 0) {
      mantissa <<= 1;
      exponent -= 1;
    }
    exponent += 1;
    mantissa &= ~0x400;
  } else if (exponent === 31) {
    return new Float32Array(new Uint32Array([sign | 0x7f800000 | (mantissa << 13)]).buffer)[0];
  }
  const bits = sign | ((exponent + 127 - 15) << 23) | (mantissa << 13);
  return new Float32Array(new Uint32Array([bits]).buffer)[0];
}
