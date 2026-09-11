import { emitMeshDescriptors, MESH_KERNEL_WINDOW_SIZE, meshKernelWindowIndex } from './mesh-kernel';
import type { MeshData } from '@seedlands/stdlib/world/mesh';
import { Voxel, faceMaterialFor } from '@seedlands/stdlib/world/voxel';

const CHUNK_SIZE = 32;
const RECORD_BYTES = 16;
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

type MaskCell = { material: number; back: boolean; ao: readonly number[]; high: number; low: number };

const sample = (voxelWindow: Uint16Array, x: number, y: number, z: number) =>
  voxelWindow[meshKernelWindowIndex(x, y, z)];
const sampleFluid = (fluid: Uint8Array, x: number, y: number, z: number) => fluid[meshKernelWindowIndex(x, y, z)];
const isGreedyVoxel = (voxel: number) => voxel !== Voxel.Air && voxel !== Voxel.Lantern;
const occludes = (voxel: number) => voxel !== Voxel.Air && voxel !== Voxel.Water && voxel !== Voxel.Lantern;
const visible = (source: number, target: number) =>
  isGreedyVoxel(source) &&
  (source === Voxel.Water
    ? target === Voxel.Air || (target !== Voxel.Water && !occludes(target))
    : target === Voxel.Air || target === Voxel.Water || !occludes(target));
const heightCode = (voxelWindow: Uint16Array, fluid: Uint8Array, x: number, y: number, z: number) => {
  if (sample(voxelWindow, x, y + 1, z) === Voxel.Water) return 9;
  const level = Math.max(1, Math.min(8, sampleFluid(fluid, x, y, z) & 0x0f));
  return level >= 7 ? 8 : level;
};
const coordinates = (axis: number, slice: number, i: number, j: number): [number, number, number] =>
  axis === 0 ? [slice, i, j] : axis === 1 ? [j, slice, i] : [i, j, slice];

function packedAo(voxelWindow: Uint16Array, block: readonly number[], axis: number, back: boolean): number {
  const normal = back ? -1 : 1;
  const outside = [...block];
  outside[axis] += normal;
  const u = (axis + 1) % 3;
  const v = (axis + 2) % 3;
  return (back ? BACK_CORNERS : FRONT_CORNERS).reduce((packed, [su, sv], corner) => {
    const sideU = [...outside];
    sideU[u] += su;
    const sideV = [...outside];
    sideV[v] += sv;
    const cornerCell = [...outside];
    cornerCell[u] += su;
    cornerCell[v] += sv;
    const occupiedU = occludes(sample(voxelWindow, sideU[0], sideU[1], sideU[2]));
    const occupiedV = occludes(sample(voxelWindow, sideV[0], sideV[1], sideV[2]));
    const level =
      occupiedU && occupiedV
        ? 3
        : Number(occupiedU) +
          Number(occupiedV) +
          Number(occludes(sample(voxelWindow, cornerCell[0], cornerCell[1], cornerCell[2])));
    return packed | (level << (corner * 2));
  }, 0);
}

const same = (left: MaskCell | null | undefined, right: MaskCell) =>
  left?.material === right.material &&
  left.back === right.back &&
  left.high === right.high &&
  left.low === right.low &&
  left.ao.every((value, index) => value === right.ao[index]);

const appendQuad = (
  bytes: number[],
  material: number,
  axis: number,
  back: boolean,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  ao: number,
  high: number,
  low: number,
) => bytes.push(0, material, axis, Number(back), x, y, z, width, height, ao, high, low, 0, 0, 0, 0);

/** 与 Wasm 完全共享 36³ 输入及发射层的 TypeScript 扫描对照。 */
export function describeMeshInTypeScript(voxelWindow: Uint16Array, fluid: Uint8Array): Uint8Array {
  if (voxelWindow.length !== MESH_KERNEL_WINDOW_SIZE ** 3 || fluid.length !== MESH_KERNEL_WINDOW_SIZE ** 3)
    throw new RangeError('Mesh descriptor control requires an exact 36³ voxel and fluid window.');
  const bytes: number[] = [];
  for (let axis = 0; axis < 3; axis += 1) {
    for (let slice = -1; slice < CHUNK_SIZE; slice += 1) {
      const mask: (MaskCell | null)[] = new Array(CHUNK_SIZE * CHUNK_SIZE);
      let m = 0;
      for (let j = 0; j < CHUNK_SIZE; j += 1)
        for (let i = 0; i < CHUNK_SIZE; i += 1) {
          const [x, y, z] = coordinates(axis, slice, i, j);
          const [nx, ny, nz] = coordinates(axis, slice + 1, i, j);
          const a = sample(voxelWindow, x, y, z);
          const b = sample(voxelWindow, nx, ny, nz);
          const aHeight = a === Voxel.Water ? heightCode(voxelWindow, fluid, x, y, z) : 0;
          const bHeight = b === Voxel.Water ? heightCode(voxelWindow, fluid, nx, ny, nz) : 0;
          const stepped = axis !== 1 && a === Voxel.Water && b === Voxel.Water && aHeight !== bHeight;
          const forward = stepped ? aHeight > bHeight : visible(a, b);
          const back = stepped ? bHeight > aHeight : !forward && visible(b, a);
          if (!forward && !back) {
            mask[m++] = null;
            continue;
          }
          const id = back ? b : a;
          const block = back ? coordinates(axis, slice + 1, i, j) : [x, y, z];
          const material = faceMaterialFor(id, axis, !back) ?? 0xff;
          const packed = id === Voxel.Water ? 0 : packedAo(voxelWindow, block, axis, back);
          mask[m++] = {
            material,
            back,
            ao: [packed & 3, (packed >>> 2) & 3, (packed >>> 4) & 3, (packed >>> 6) & 3],
            high: id === Voxel.Water ? (stepped ? Math.max(aHeight, bHeight) : back ? bHeight : aHeight) : 0,
            low: stepped ? Math.min(aHeight, bHeight) : 0,
          };
        }
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
          while (i + width < CHUNK_SIZE && same(mask[m + width], cell)) width += 1;
          let height = 1;
          outer: for (; j + height < CHUNK_SIZE; height += 1)
            for (let column = 0; column < width; column += 1)
              if (!same(mask[m + column + height * CHUNK_SIZE], cell)) break outer;
          const [x, y, z] = coordinates(axis, slice + 1, i, j);
          const ao = cell.ao[0] | (cell.ao[1] << 2) | (cell.ao[2] << 4) | (cell.ao[3] << 6);
          appendQuad(bytes, cell.material, axis, cell.back, x, y, z, width, height, ao, cell.high, cell.low);
          for (let row = 0; row < height; row += 1)
            for (let column = 0; column < width; column += 1) mask[m + column + row * CHUNK_SIZE] = null;
          i += width;
          m += width;
        }
    }
  }
  for (let y = 0; y < CHUNK_SIZE; y += 1)
    for (let z = 0; z < CHUNK_SIZE; z += 1)
      for (let x = 0; x < CHUNK_SIZE; x += 1)
        if (sample(voxelWindow, x, y, z) === Voxel.Lantern)
          bytes.push(1, x, y, z, ...new Array(RECORD_BYTES - 4).fill(0));
  return Uint8Array.from(bytes);
}

/** 共享发射器使该对照只替换扫描循环，不混入顶点数组布局差异。 */
export function runMeshDescriptorControl(voxelWindow: Uint16Array, fluid: Uint8Array): Record<number, MeshData> {
  return emitMeshDescriptors(describeMeshInTypeScript(voxelWindow, fluid));
}
