import { KernelMemory, WASM_ARENA_BYTES } from './kernel-memory';

const CHUNK_ROWS = 1024;
const FRONTIER_ROWS = 8192;
const WRITES = 4 * 1024 * 1024;
const NEXT = 5 * 1024 * 1024;
const MAX_CHUNKS = 32;
const MAX_POSITIONS = 192;
const MAX_WRITES = 2048;
const MAX_NEXT = 16384;

type RawViews = {
  readonly bytes: Uint8Array;
  readonly u16: Uint16Array;
  readonly u32: Uint32Array;
  readonly i32: Int32Array;
};

const intAt = (views: RawViews, offset: number) => views.i32[offset >>> 2];
const u32At = (views: RawViews, offset: number) => views.u32[offset >>> 2];
const putU32 = (views: RawViews, offset: number, value: number) => {
  views.u32[offset >>> 2] = value >>> 0;
};
const fluidChunkCoord = (value: number) => Math.trunc(value < 0 ? (value - 31) / 32 : value / 32);

/**
 * 镜像 W07 标量参考算法的线性查找、unknown 计数、原值表和 arena 行布局。
 * 这不是优化实现，供 W07 区分布局/算法变化与 Wasm 执行贡献。
 */
function fluidCandidate(views: RawViews, count: number): number {
  const fluidAddress = (x: number, y: number, z: number): readonly [number, number] => {
    const cx = fluidChunkCoord(x);
    const cy = fluidChunkCoord(y);
    const cz = fluidChunkCoord(z);
    for (let index = 0; index < intAt(views, 64); index += 1) {
      const row = CHUNK_ROWS + index * 20;
      if (intAt(views, row) === cx && intAt(views, row + 4) === cy && intAt(views, row + 8) === cz) {
        const localIndex = x - cx * 32 + 32 * (z - cz * 32 + 32 * (y - cy * 32));
        return [intAt(views, row + 12) + localIndex * 2, intAt(views, row + 16) + localIndex];
      }
    }
    putU32(views, 68, u32At(views, 68) + 1);
    return [-1, -1];
  };

  const cell = (x: number, y: number, z: number): number => {
    const [voxelPointer, fluidPointer] = fluidAddress(x, y, z);
    if (voxelPointer < 0) return -1;
    const voxel = views.u16[voxelPointer >>> 1];
    const fluid = views.bytes[fluidPointer];
    const level = voxel === 8 && fluid === 0 ? 0x88 : fluid;
    return voxel | (level << 16) | 0;
  };
  const water = (value: number) => value >= 0 && (value & 0xffff) === 8;
  const level = (value: number) => (value >> 16) & 15;
  const activate = (x: number, y: number, z: number): void => {
    if (y < 0 || y > 63) return;
    const nextCount = intAt(views, 76);
    if (nextCount >= MAX_NEXT) {
      putU32(views, 80, 1);
      return;
    }
    const row = NEXT + nextCount * 12;
    putU32(views, row, x);
    putU32(views, row + 4, y);
    putU32(views, row + 8, z);
    putU32(views, 76, nextCount + 1);
  };
  const neighborhood = (x: number, y: number, z: number): void => {
    activate(x, y, z);
    activate(x, y - 1, z);
    activate(x, y + 1, z);
    activate(x - 1, y, z);
    activate(x + 1, y, z);
    activate(x, y, z - 1);
    activate(x, y, z + 1);
  };
  const write = (x: number, y: number, z: number, voxel: number, fluid: number): void => {
    const [voxelPointer, fluidPointer] = fluidAddress(x, y, z);
    if (voxelPointer < 0) return;
    const writeCount = intAt(views, 72);
    let seen = false;
    for (let index = 0; index < writeCount; index += 1) {
      if (intAt(views, WRITES + index * 24 + 16) === voxelPointer) {
        seen = true;
        break;
      }
    }
    if (!seen) {
      if (writeCount >= MAX_WRITES) {
        putU32(views, 80, 1);
        return;
      }
      const row = WRITES + writeCount * 24;
      putU32(views, row, x);
      putU32(views, row + 4, y);
      putU32(views, row + 8, z);
      putU32(views, row + 12, views.u16[voxelPointer >>> 1] | (views.bytes[fluidPointer] << 16));
      putU32(views, row + 16, voxelPointer);
      putU32(views, row + 20, fluidPointer);
      putU32(views, 72, writeCount + 1);
    }
    views.u16[voxelPointer >>> 1] = voxel;
    views.bytes[fluidPointer] = fluid;
  };
  const place = (x: number, y: number, z: number, desiredLevel: number): void => {
    const [voxelPointer, fluidPointer] = fluidAddress(x, y, z);
    if (voxelPointer < 0) return;
    const voxel = views.u16[voxelPointer >>> 1];
    if (voxel !== 0 && voxel !== 8) return;
    const next = Math.max(1, Math.min(8, desiredLevel));
    if (voxel === 8 && views.bytes[fluidPointer] === next) return;
    write(x, y, z, 8, next);
    neighborhood(x, y, z);
  };
  const side = (x: number, z: number, direction: number): readonly [number, number] =>
    direction === 0 ? [x - 1, z] : direction === 1 ? [x + 1, z] : direction === 2 ? [x, z - 1] : [x, z + 1];

  if (count < 0 || count > MAX_POSITIONS || intAt(views, 64) < 0 || intAt(views, 64) > MAX_CHUNKS) return 1;
  for (let index = 0; index < count; index += 1) {
    const row = FRONTIER_ROWS + index * 12;
    const x = intAt(views, row);
    const y = intAt(views, row + 4);
    const z = intAt(views, row + 8);
    const current = cell(x, y, z);
    if (!water(current)) continue;
    const currentLevel = level(current);
    const source = (current & 0x800000) !== 0;
    if (!source) {
      const unknownBefore = u32At(views, 68);
      const above = cell(x, y + 1, z);
      let desired = 0;
      if (water(above)) desired = 8;
      else
        for (let direction = 0; direction < 4; direction += 1) {
          const [sideX, sideZ] = side(x, z, direction);
          const neighbor = cell(sideX, y, sideZ);
          if (water(neighbor) && level(neighbor) - 1 > desired) desired = level(neighbor) - 1;
        }
      const aboveAgain = cell(x, y + 1, z);
      let stronger = false;
      for (let direction = 0; direction < 4; direction += 1) {
        const [sideX, sideZ] = side(x, z, direction);
        const neighbor = cell(sideX, y, sideZ);
        if (water(neighbor) && level(neighbor) > currentLevel) {
          stronger = true;
          break;
        }
      }
      if (!water(aboveAgain) && !stronger && desired > currentLevel - 1) desired = currentLevel - 1;
      if (desired < currentLevel && unknownBefore !== u32At(views, 68)) {
        activate(x, y, z);
        continue;
      }
      if (desired <= 0) {
        write(x, y, z, 0, 0);
        neighborhood(x, y, z);
        continue;
      }
      if (desired !== currentLevel) {
        write(x, y, z, 8, desired);
        neighborhood(x, y, z);
      }
    }
    const below = cell(x, y - 1, z);
    if (below < 0) continue;
    if ((below & 0xffff) === 0) {
      place(x, y - 1, z, 8);
      activate(x, y, z);
      continue;
    }
    if (water(below)) continue;
    const settled = cell(x, y, z);
    const settledLevel = settled < 0 ? 0 : level(settled);
    if (settledLevel <= 1) continue;
    for (let direction = 0; direction < 4; direction += 1) {
      const [sideX, sideZ] = side(x, z, direction);
      const target = cell(sideX, y, sideZ);
      if (target < 0) continue;
      if ((target & 0xffff) === 0 || (water(target) && (target & 0x800000) === 0 && level(target) < settledLevel - 1))
        place(sideX, y, sideZ, settledLevel - 1);
    }
  }
  return intAt(views, 80);
}

/**
 * 创建与线性 Wasm 相同的独立 16MiB arena。视图只在这里创建一次，执行时不
 * 分配 raw-access TypedArray；`fluid_candidate` 是机械翻译的 JS 导出。
 */
export function createFluidControlMemory(): KernelMemory {
  const memory = new WebAssembly.Memory({ initial: 256, maximum: 512 });
  if (memory.buffer.byteLength !== WASM_ARENA_BYTES) throw new Error('Fluid control arena has an unexpected size.');
  const views: RawViews = {
    bytes: new Uint8Array(memory.buffer),
    u16: new Uint16Array(memory.buffer),
    u32: new Uint32Array(memory.buffer),
    i32: new Int32Array(memory.buffer),
  };
  const rawExports = {
    memory,
    abi_version: () => 1,
    arena_bytes: () => WASM_ARENA_BYTES,
    fluid_candidate: (count: number) => fluidCandidate(views, count),
  };
  return new KernelMemory(rawExports as unknown as WebAssembly.Exports);
}
