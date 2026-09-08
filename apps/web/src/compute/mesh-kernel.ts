import { KernelMemory } from './kernel-memory';
import { meshHaloIndex, type MeshData, type MeshOptions } from '@seedlands/game-core/world/mesh';
import { macroAt, type MacroContext } from '@seedlands/game-core/world/macro-world';
import { renderCategoryForMaterial } from '@seedlands/game-core/world/mesh-render-category';
import { modelBoxesForVoxel } from '@seedlands/game-core/world/voxel-model';
import { shapeWaterFace } from '@seedlands/game-core/world/water-mesh-height';
import {
  CHUNK_SIZE,
  GENERATOR_VERSION,
  Voxel,
  baseVoxel,
  chunkKey,
  voxelIndex,
  type FaceMaterialId,
} from '@seedlands/game-core/world/voxel';

const ARENA_START = 64;
export const MESH_KERNEL_WINDOW_SIZE = CHUNK_SIZE + 4;
const WINDOW_CELL_COUNT = MESH_KERNEL_WINDOW_SIZE ** 3;
const WINDOW_OFFSET = ARENA_START;
const FLUID_WINDOW_OFFSET = WINDOW_OFFSET + WINDOW_CELL_COUNT * Uint16Array.BYTES_PER_ELEMENT;
const OUTPUT_OFFSET = FLUID_WINDOW_OFFSET + WINDOW_CELL_COUNT;
const MASK_BYTES = 32 ** 2 * 6;
const DESCRIPTOR_OFFSET = OUTPUT_OFFSET + MASK_BYTES;
const DESCRIPTOR_BYTES = 16;
const MAX_DESCRIPTOR_RECORDS = 3 * (CHUNK_SIZE + 1) * CHUNK_SIZE * CHUNK_SIZE + CHUNK_SIZE ** 3;
const MAX_DESCRIPTOR_BYTES = MAX_DESCRIPTOR_RECORDS * DESCRIPTOR_BYTES;
const AO_BRIGHTNESS = [255, 220, 190, 160] as const;

type RawMesh = { p: number[]; n: number[]; uv: number[]; c: number[]; i: number[] };

const assertInput = (voxelWindow: Uint16Array, fluidWindow: Uint8Array): void => {
  if (!(voxelWindow instanceof Uint16Array) || voxelWindow.length !== WINDOW_CELL_COUNT)
    throw new RangeError(`Mesh window must contain exactly ${WINDOW_CELL_COUNT} u16 cells.`);
  if (!(fluidWindow instanceof Uint8Array) || fluidWindow.length !== WINDOW_CELL_COUNT)
    throw new RangeError(`Mesh fluid window must contain exactly ${WINDOW_CELL_COUNT} u8 cells.`);
};

export const meshKernelWindowIndex = (x: number, y: number, z: number) =>
  x + 2 + MESH_KERNEL_WINDOW_SIZE * (z + 2 + MESH_KERNEL_WINDOW_SIZE * (y + 2));

export type MeshKernelInput = Record<'window', Uint16Array> & { fluidWindow: Uint8Array };

/**
 * 准备既有 source-face 遍历所需的 36³ ABI 窗。扫描本身只读取一圈
 * `[-1, 32]`：AO 的法线外侧和两个角点不会越过这一范围。唯一的第二圈
 * 读取是 y=32 的水在 Y 轴顶面计算水高时读取 `(x, 33, z)`；它只可能发生
 * 在 canonical x/z 上，且仅当该 y=32 单元是水。其余保留 ABI 单元绝不会被
 * 描述符核读取，保持零值以避免无用的 `baseVoxel`/宏观地形查询。
 */
export function createMeshKernelInput({
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
}: MeshOptions): MeshKernelInput {
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
    const wx = cx * CHUNK_SIZE + x;
    const wy = cy * CHUNK_SIZE + y;
    const wz = cz * CHUNK_SIZE + z;
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
  const voxelWindow = new Uint16Array(WINDOW_CELL_COUNT);
  const fluidWindow = new Uint8Array(WINDOW_CELL_COUNT);
  for (let y = -1; y <= CHUNK_SIZE; y += 1)
    for (let z = -1; z <= CHUNK_SIZE; z += 1)
      for (let x = -1; x <= CHUNK_SIZE; x += 1) {
        const index = meshKernelWindowIndex(x, y, z);
        voxelWindow[index] = sample(x, y, z);
        fluidWindow[index] = sampleFluid(x, y, z);
      }
  for (let z = 0; z < CHUNK_SIZE; z += 1)
    for (let x = 0; x < CHUNK_SIZE; x += 1)
      if (voxelWindow[meshKernelWindowIndex(x, CHUNK_SIZE, z)] === Voxel.Water)
        voxelWindow[meshKernelWindowIndex(x, CHUNK_SIZE + 1, z)] = sample(x, CHUNK_SIZE + 1, z);
  return { window: voxelWindow, fluidWindow };
}

const materialForDescriptor = (value: number): FaceMaterialId => (value === 0xff ? undefined : value) as FaceMaterialId;

const waterHeight = (code: number): number => (code === 9 ? 1 : code === 8 ? 7 / 8 : code / 8);

function append(
  result: Record<number, RawMesh>,
  material: FaceMaterialId,
  vertices: number[],
  normal: number[],
  normalAxis: number,
  width: number,
  height: number,
  back: boolean,
  ao: readonly number[],
  waterSurfaceCode: number,
  waterFloorCode: number,
): void {
  const quad = (result[material] ??= { p: [], n: [], uv: [], c: [], i: [] });
  const start = quad.p.length / 3;
  shapeWaterFace(
    material,
    normalAxis,
    back,
    waterSurfaceCode === 0 ? 0 : waterHeight(waterSurfaceCode),
    waterFloorCode === 0 ? 0 : waterHeight(waterFloorCode),
    vertices,
  );
  quad.p.push(...vertices);
  quad.n.push(...normal, ...normal, ...normal, ...normal);
  if (normalAxis === 0)
    quad.uv.push(...(back ? [0, 0, height, 0, height, width, 0, width] : [0, 0, 0, width, height, width, height, 0]));
  else
    quad.uv.push(...(back ? [0, 0, 0, height, width, height, width, 0] : [0, 0, width, 0, width, height, 0, height]));
  for (const level of ao) {
    const brightness = AO_BRIGHTNESS[level];
    quad.c.push(brightness, brightness, brightness, 255);
  }
  if (ao[0] + ao[2] > ao[1] + ao[3]) quad.i.push(start, start + 1, start + 3, start + 1, start + 2, start + 3);
  else quad.i.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

function appendModel(result: Record<number, RawMesh>, x: number, y: number, z: number): void {
  for (const box of modelBoxesForVoxel(Voxel.Lantern)) {
    for (let dimension = 0; dimension < 3; dimension += 1) {
      const u = (dimension + 1) % 3;
      const v = (dimension + 2) % 3;
      const width = box.max[u] - box.min[u];
      const height = box.max[v] - box.min[v];
      for (const back of [true, false]) {
        const origin = [x + box.min[0], y + box.min[1], z + box.min[2]];
        origin[dimension] = (back ? box.min[dimension] : box.max[dimension]) + [x, y, z][dimension];
        const p1 = [...origin];
        p1[u] += width;
        const p2 = [...p1];
        p2[v] += height;
        const p3 = [...origin];
        p3[v] += height;
        const normal = [0, 0, 0];
        normal[dimension] = back ? -1 : 1;
        append(
          result,
          box.material,
          back ? [...origin, ...p3, ...p2, ...p1] : [...origin, ...p1, ...p2, ...p3],
          normal,
          dimension,
          width,
          height,
          back,
          [0, 0, 0, 0],
          0,
          0,
        );
      }
    }
  }
}

/** 将已校验的描述符按既有五数组布局发射；不扫描体素。 */
export function emitMeshDescriptors(descriptors: Uint8Array): Record<number, MeshData> {
  if (descriptors.length % DESCRIPTOR_BYTES !== 0 || descriptors.length > MAX_DESCRIPTOR_BYTES)
    throw new Error('Mesh descriptors have an invalid byte length.');
  const result: Record<number, RawMesh> = {};
  for (let offset = 0; offset < descriptors.length; offset += DESCRIPTOR_BYTES) {
    const kind = descriptors[offset];
    if (kind === 0) {
      if (descriptors[offset + 1] === 0xff)
        throw new Error('Mesh descriptor encountered an unknown voxel material, matching meshChunk rejection.');
      const material = materialForDescriptor(descriptors[offset + 1]);
      const dimension = descriptors[offset + 2];
      const back = descriptors[offset + 3] === 1;
      if (
        (descriptors[offset + 1] !== 0xff && (descriptors[offset + 1] < 1 || descriptors[offset + 1] > 13)) ||
        dimension > 2 ||
        descriptors[offset + 3] > 1 ||
        descriptors[offset + 4] > 32 ||
        descriptors[offset + 5] > 32 ||
        descriptors[offset + 6] > 32 ||
        descriptors[offset + 7] === 0 ||
        descriptors[offset + 7] > 32 ||
        descriptors[offset + 8] === 0 ||
        descriptors[offset + 8] > 32 ||
        descriptors[offset + 10] > 9 ||
        descriptors[offset + 11] > 9 ||
        descriptors[offset + 12] !== 0 ||
        descriptors[offset + 13] !== 0 ||
        descriptors[offset + 14] !== 0 ||
        descriptors[offset + 15] !== 0
      )
        throw new Error('Wasm mesh descriptor contains an invalid greedy quad.');
      const u = (dimension + 1) % 3;
      const v = (dimension + 2) % 3;
      const p = [descriptors[offset + 4], descriptors[offset + 5], descriptors[offset + 6]];
      const p1 = [...p];
      p1[u] += descriptors[offset + 7];
      const p2 = [...p1];
      p2[v] += descriptors[offset + 8];
      const p3 = [...p];
      p3[v] += descriptors[offset + 8];
      const normal = [0, 0, 0];
      normal[dimension] = back ? -1 : 1;
      const packedAo = descriptors[offset + 9];
      append(
        result,
        material,
        back ? [...p, ...p3, ...p2, ...p1] : [...p, ...p1, ...p2, ...p3],
        normal,
        dimension,
        descriptors[offset + 7],
        descriptors[offset + 8],
        back,
        [packedAo & 3, (packedAo >>> 2) & 3, (packedAo >>> 4) & 3, (packedAo >>> 6) & 3],
        descriptors[offset + 10],
        descriptors[offset + 11],
      );
    } else if (
      kind === 1 &&
      descriptors[offset + 1] < 32 &&
      descriptors[offset + 2] < 32 &&
      descriptors[offset + 3] < 32 &&
      descriptors.slice(offset + 4, offset + DESCRIPTOR_BYTES).every((value) => value === 0)
    )
      appendModel(result, descriptors[offset + 1], descriptors[offset + 2], descriptors[offset + 3]);
    else throw new Error('Wasm mesh descriptor contains an unknown record kind.');
  }
  return Object.fromEntries(
    Object.entries(result).map(([material, value]) => {
      const materialId = Number(material) as FaceMaterialId;
      return [
        materialId,
        {
          material: materialId,
          renderCategory: renderCategoryForMaterial(materialId),
          layout: 'float32' as const,
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

/** 运行 W04/W05 的纯窗口到描述符阶段，再由共享发射器构造最终数组。 */
export function runMeshDescriptorKernel(
  kernel: KernelMemory,
  voxelWindow: Uint16Array,
  fluidWindow: Uint8Array,
): Record<number, MeshData> {
  assertInput(voxelWindow, fluidWindow);
  kernel.u16(WINDOW_OFFSET, voxelWindow.length).set(voxelWindow);
  kernel.bytes(FLUID_WINDOW_OFFSET, fluidWindow.length).set(fluidWindow);
  const length = kernel.invoke(
    'mesh_describe',
    WINDOW_OFFSET,
    FLUID_WINDOW_OFFSET,
    OUTPUT_OFFSET,
    MAX_DESCRIPTOR_BYTES,
  );
  if (length < 0) throw new Error(`Wasm mesh descriptor kernel rejected ABI input with status ${length}.`);
  if (!Number.isSafeInteger(length) || length % DESCRIPTOR_BYTES !== 0 || length > MAX_DESCRIPTOR_BYTES)
    throw new RangeError('Wasm mesh descriptor returned an invalid descriptor byte length.');
  return emitMeshDescriptors(kernel.bytes(DESCRIPTOR_OFFSET, length).slice());
}
