import {
  CHUNK_SIZE,
  FaceMaterial,
  Voxel,
  baseVoxel,
  chunkKey,
  faceMaterialFor,
  isSolid,
  voxelIndex,
  type FaceMaterialId,
} from './voxel';
import { macroAt, type MacroContext } from './macro-world';

export type WorldChange = [number, number, number, number];
export type RenderLayer = 'opaque' | 'water';
export type MeshData = {
  material: FaceMaterialId;
  renderLayer: RenderLayer;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Uint8Array;
  indices: Uint32Array;
};
type Quad = { p: number[]; n: number[]; uv: number[]; c: number[]; i: number[] };
type MaskCell = {
  material: FaceMaterialId;
  renderLayer: RenderLayer;
  back: boolean;
  ao: readonly [number, number, number, number];
};
export type MeshOptions = {
  seed: number;
  cx: number;
  cy: number;
  cz: number;
  data: Uint16Array;
  changes: WorldChange[];
  outside?: (x: number, y: number, z: number) => number;
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

export function makeChunk(seed: number, cx: number, cy: number, cz: number, changes: WorldChange[]): Uint16Array {
  const data = new Uint16Array(CHUNK_SIZE ** 3);
  const ox = cx * CHUNK_SIZE,
    oy = cy * CHUNK_SIZE,
    oz = cz * CHUNK_SIZE;
  const macroCache = new Map<string, MacroContext>();
  const queryMacro = (x: number, z: number) => {
    const key = chunkKey(x, 0, z);
    let context = macroCache.get(key);
    if (!context) {
      context = macroAt(seed, x, z);
      macroCache.set(key, context);
    }
    return context;
  };
  for (let z = 0; z < CHUNK_SIZE; z += 1)
    for (let x = 0; x < CHUNK_SIZE; x += 1) {
      const context = queryMacro(ox + x, oz + z);
      for (let y = 0; y < CHUNK_SIZE; y += 1)
        data[voxelIndex(x, y, z)] = baseVoxel(seed, ox + x, oy + y, oz + z, context, queryMacro);
    }
  for (const [x, y, z, value] of changes) {
    if (Math.floor(x / CHUNK_SIZE) === cx && Math.floor(y / CHUNK_SIZE) === cy && Math.floor(z / CHUNK_SIZE) === cz) {
      const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
        ly = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
        lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      data[voxelIndex(lx, ly, lz)] = value;
    }
  }
  return data;
}

const isVisibleFace = (source: number, target: number) =>
  source !== Voxel.Air &&
  (source === Voxel.Water ? target === Voxel.Air : target === Voxel.Air || target === Voxel.Water);

const sameMaskCell = (left: MaskCell | null | undefined, right: MaskCell) =>
  left?.material === right.material &&
  left.renderLayer === right.renderLayer &&
  left.back === right.back &&
  left.ao.every((value, index) => value === right.ao[index]);

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
    const occupiedU = isSolid(sample(sideU[0], sideU[1], sideU[2]));
    const occupiedV = isSolid(sample(sideV[0], sideV[1], sideV[2]));
    if (occupiedU && occupiedV) return 3;
    return Number(occupiedU) + Number(occupiedV) + Number(isSolid(sample(corner[0], corner[1], corner[2])));
  });
  return values as unknown as readonly [number, number, number, number];
}

export function meshChunk({ seed, cx, cy, cz, data, changes, outside }: MeshOptions): Record<number, MeshData> {
  const result: Record<number, Quad> = {};
  const overrides = new Map(changes.map(([x, y, z, value]) => [`${x},${y},${z}`, value]));
  const macroCache = new Map<string, MacroContext>();
  const queryMacro = (x: number, z: number) => {
    const key = chunkKey(x, 0, z);
    let context = macroCache.get(key);
    if (!context) {
      context = macroAt(seed, x, z);
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
    return (
      overrides.get(`${wx},${wy},${wz}`) ??
      outside?.(wx, wy, wz) ??
      baseVoxel(seed, wx, wy, wz, queryMacro(wx, wz), queryMacro)
    );
  };
  const add = (
    material: FaceMaterialId,
    vertices: number[],
    normal: number[],
    width: number,
    height: number,
    back: boolean,
    ao: readonly number[],
  ) => {
    const quad = (result[material] ??= { p: [], n: [], uv: [], c: [], i: [] });
    const start = quad.p.length / 3;
    quad.p.push(...vertices);
    quad.n.push(...normal, ...normal, ...normal, ...normal);
    quad.uv.push(...(back ? [0, 0, 0, height, width, height, width, 0] : [0, 0, width, 0, width, height, 0, height]));
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
    const mask: (MaskCell | null)[] = new Array(CHUNK_SIZE * CHUNK_SIZE);
    for (x[d] = -1; x[d] < CHUNK_SIZE;) {
      let m = 0;
      for (x[v] = 0; x[v] < CHUNK_SIZE; x[v] += 1)
        for (x[u] = 0; x[u] < CHUNK_SIZE; x[u] += 1) {
          const a = sample(x[0], x[1], x[2]);
          const b = sample(x[0] + q[0], x[1] + q[1], x[2] + q[2]);
          const forward = isVisibleFace(a, b);
          const back = !forward && isVisibleFace(b, a);
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
            renderLayer: material === FaceMaterial.Water ? 'water' : 'opaque',
            back,
            ao: id === Voxel.Water ? [0, 0, 0, 0] : vertexAo(block, d, u, v, back, sample),
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
          while (i + width < CHUNK_SIZE && sameMaskCell(mask[m + width], cell)) width += 1;
          let height = 1;
          outer: for (; j + height < CHUNK_SIZE; height += 1)
            for (let offset = 0; offset < width; offset += 1)
              if (!sameMaskCell(mask[m + offset + height * CHUNK_SIZE], cell)) break outer;
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
            width,
            height,
            cell.back,
            cell.ao,
          );
          for (let row = 0; row < height; row += 1)
            for (let column = 0; column < width; column += 1) mask[m + column + row * CHUNK_SIZE] = null;
          i += width;
          m += width;
        }
    }
  }
  return Object.fromEntries(
    Object.entries(result).map(([material, value]) => {
      const materialId = Number(material) as FaceMaterialId;
      return [
        materialId,
        {
          material: materialId,
          renderLayer: materialId === FaceMaterial.Water ? 'water' : 'opaque',
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
