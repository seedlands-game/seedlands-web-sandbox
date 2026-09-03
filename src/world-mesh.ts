import { CHUNK_SIZE, baseVoxel, chunkKey, isRenderable, voxelIndex } from './voxel';
import { macroAt, type MacroContext } from './macro-world';

export type WorldChange = [number, number, number, number];
export type MeshData = { positions: Float32Array; normals: Float32Array; indices: Uint32Array };
type Quad = { p: number[]; n: number[]; i: number[] };
export type MeshOptions = { seed: number; cx: number; cy: number; cz: number; data: Uint16Array; changes: WorldChange[]; outside?: (x: number, y: number, z: number) => number };

export function makeChunk(seed: number, cx: number, cy: number, cz: number, changes: WorldChange[]): Uint16Array {
  const data = new Uint16Array(CHUNK_SIZE ** 3);
  const ox = cx * CHUNK_SIZE, oy = cy * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
  const macroCache = new Map<string, MacroContext>();
  const queryMacro = (x: number, z: number) => {
    const key = chunkKey(x, 0, z);
    let context = macroCache.get(key);
    if (!context) { context = macroAt(seed, x, z); macroCache.set(key, context); }
    return context;
  };
  for (let z = 0; z < CHUNK_SIZE; z += 1) for (let x = 0; x < CHUNK_SIZE; x += 1) {
    const context = queryMacro(ox + x, oz + z);
    for (let y = 0; y < CHUNK_SIZE; y += 1) data[voxelIndex(x, y, z)] = baseVoxel(seed, ox + x, oy + y, oz + z, context, queryMacro);
  }
  for (const [x, y, z, value] of changes) {
    if (Math.floor(x / CHUNK_SIZE) === cx && Math.floor(y / CHUNK_SIZE) === cy && Math.floor(z / CHUNK_SIZE) === cz) {
      const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE, ly = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE, lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      data[voxelIndex(lx, ly, lz)] = value;
    }
  }
  return data;
}

export function meshChunk({ seed, cx, cy, cz, data, changes, outside }: MeshOptions): Record<number, MeshData> {
  const result: Record<number, Quad> = {};
  const overrides = new Map(changes.map(([x, y, z, v]) => [`${x},${y},${z}`, v]));
  const macroCache = new Map<string, MacroContext>();
  const queryMacro = (x: number, z: number) => {
    const key = chunkKey(x, 0, z);
    let context = macroCache.get(key);
    if (!context) { context = macroAt(seed, x, z); macroCache.set(key, context); }
    return context;
  };
  const sample = (x: number, y: number, z: number): number => {
    if (x >= 0 && y >= 0 && z >= 0 && x < CHUNK_SIZE && y < CHUNK_SIZE && z < CHUNK_SIZE) return data[voxelIndex(x, y, z)];
    const wx = cx * CHUNK_SIZE + x, wy = cy * CHUNK_SIZE + y, wz = cz * CHUNK_SIZE + z;
    return overrides.get(`${wx},${wy},${wz}`) ?? outside?.(wx, wy, wz) ?? baseVoxel(seed, wx, wy, wz, queryMacro(wx, wz), queryMacro);
  };
  const add = (id: number, vertices: number[], normal: number[]) => {
    const q = result[id] ??= { p: [], n: [], i: [] };
    const start = q.p.length / 3;
    q.p.push(...vertices); q.n.push(...normal, ...normal, ...normal, ...normal);
    q.i.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };
  for (let d = 0; d < 3; d += 1) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    const x = [0, 0, 0]; const q = [0, 0, 0]; q[d] = 1;
    const mask: ({ id: number; back: boolean } | null)[] = new Array(CHUNK_SIZE * CHUNK_SIZE);
    for (x[d] = -1; x[d] < CHUNK_SIZE;) {
      let m = 0;
      for (x[v] = 0; x[v] < CHUNK_SIZE; x[v] += 1) for (x[u] = 0; x[u] < CHUNK_SIZE; x[u] += 1) {
        const a = sample(x[0], x[1], x[2]); const b = sample(x[0] + q[0], x[1] + q[1], x[2] + q[2]);
        mask[m++] = isRenderable(a) && !isRenderable(b) ? { id: a, back: false } : isRenderable(b) && !isRenderable(a) ? { id: b, back: true } : null;
      }
      x[d] += 1; m = 0;
      for (let j = 0; j < CHUNK_SIZE; j += 1) for (let i = 0; i < CHUNK_SIZE;) {
        const cell = mask[m];
        if (!cell) { i += 1; m += 1; continue; }
        let w = 1; while (i + w < CHUNK_SIZE && mask[m + w]?.id === cell.id && mask[m + w]?.back === cell.back) w += 1;
        let h = 1; outer: for (; j + h < CHUNK_SIZE; h += 1) for (let k = 0; k < w; k += 1) if (mask[m + k + h * CHUNK_SIZE]?.id !== cell.id || mask[m + k + h * CHUNK_SIZE]?.back !== cell.back) break outer;
        x[u] = i; x[v] = j; const du = [0, 0, 0]; const dv = [0, 0, 0]; du[u] = w; dv[v] = h;
        const p = [x[0], x[1], x[2]]; const p1 = [x[0] + du[0], x[1] + du[1], x[2] + du[2]];
        const p2 = [x[0] + du[0] + dv[0], x[1] + du[1] + dv[1], x[2] + du[2] + dv[2]]; const p3 = [x[0] + dv[0], x[1] + dv[1], x[2] + dv[2]];
        const normal = [0, 0, 0]; normal[d] = cell.back ? -1 : 1;
        add(cell.id, cell.back ? [...p, ...p3, ...p2, ...p1] : [...p, ...p1, ...p2, ...p3], normal);
        for (let l = 0; l < h; l += 1) for (let k = 0; k < w; k += 1) mask[m + k + l * CHUNK_SIZE] = null;
        i += w; m += w;
      }
    }
  }
  return Object.fromEntries(Object.entries(result).map(([voxel, value]) => [Number(voxel), { positions: new Float32Array(value.p), normals: new Float32Array(value.n), indices: new Uint32Array(value.i) }]));
}
