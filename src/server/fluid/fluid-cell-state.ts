import { Voxel } from '../../world/voxel';
import { CHUNK_SIZE, voxelIndex } from '../../world/voxel';
import type { ServerChunk } from '../game-server-types';
import type { FluidCell } from './voxel-fluid-runtime';

export const legacyFluid = (voxels: Uint16Array): Uint8Array =>
  Uint8Array.from(voxels, (voxel) => (voxel === Voxel.Water ? 0x88 : 0));

export const hasAdjacentWater = (
  getVoxel: (x: number, y: number, z: number) => number | undefined,
  x: number,
  y: number,
  z: number,
) =>
  getVoxel(x - 1, y, z) === Voxel.Water ||
  getVoxel(x + 1, y, z) === Voxel.Water ||
  getVoxel(x, y - 1, z) === Voxel.Water ||
  getVoxel(x, y + 1, z) === Voxel.Water ||
  getVoxel(x, y, z - 1) === Voxel.Water ||
  getVoxel(x, y, z + 1) === Voxel.Water;

export function restoredFluidPositions(chunk: ServerChunk): Array<[number, number, number]> {
  const positions: Array<[number, number, number]> = [];
  for (let index = 0; index < chunk.fluid.length; index += 1) {
    const value = chunk.fluid[index];
    if ((value & 0x0f) === 0 || (value & 0x80) !== 0) continue;
    const y = Math.floor(index / (CHUNK_SIZE * CHUNK_SIZE));
    const remainder = index - y * CHUNK_SIZE * CHUNK_SIZE;
    const z = Math.floor(remainder / CHUNK_SIZE);
    positions.push([
      chunk.cx * CHUNK_SIZE + remainder - z * CHUNK_SIZE,
      chunk.cy * CHUNK_SIZE + y,
      chunk.cz * CHUNK_SIZE + z,
    ]);
  }
  return positions;
}

export function loadedWaterPositions(chunk: ServerChunk): Array<[number, number, number]> {
  const positions: Array<[number, number, number]> = [];
  for (let y = 0; y < CHUNK_SIZE; y += 1)
    for (let z = 0; z < CHUNK_SIZE; z += 1)
      for (let x = 0; x < CHUNK_SIZE; x += 1)
        if (chunk.voxels[voxelIndex(x, y, z)] === Voxel.Water)
          positions.push([chunk.cx * CHUNK_SIZE + x, chunk.cy * CHUNK_SIZE + y, chunk.cz * CHUNK_SIZE + z]);
  return positions;
}

export function fluidCellInChunk(chunk: ServerChunk | undefined, x: number, y: number, z: number): FluidCell | null {
  if (!chunk) return null;
  const value = chunk.fluid[voxelIndex(x, y, z)];
  const level = value & 0x0f;
  return level ? { level, source: (value & 0x80) !== 0 } : null;
}

export function writeFluidCellInChunk(
  chunk: ServerChunk,
  x: number,
  y: number,
  z: number,
  cell: FluidCell | null,
): boolean {
  const index = voxelIndex(x, y, z);
  const next = cell ? cell.level | (cell.source ? 0x80 : 0) : 0;
  if (chunk.fluid[index] === next) return false;
  chunk.fluid[index] = next;
  return true;
}

export function activateLoadedFluid(
  runtime: { activate: (position: [number, number, number]) => void },
  access: { peekVoxel: (x: number, y: number, z: number) => number | undefined },
  chunk: ServerChunk,
  restored: boolean,
): void {
  const activate = (position: [number, number, number]) => runtime.activate(position);
  if (restored) restoredFluidPositions(chunk).forEach(activate);
  loadedWaterPositions(chunk).forEach(activate);
  const [minX, minY, minZ] = [chunk.cx, chunk.cy, chunk.cz].map((value) => value * CHUNK_SIZE);
  for (let a = 0; a < CHUNK_SIZE; a += 1)
    for (let b = 0; b < CHUNK_SIZE; b += 1) {
      const candidates: Array<[number, number, number]> = [
        [minX - 1, minY + a, minZ + b],
        [minX + CHUNK_SIZE, minY + a, minZ + b],
        [minX + a, minY - 1, minZ + b],
        [minX + a, minY + CHUNK_SIZE, minZ + b],
        [minX + a, minY + b, minZ - 1],
        [minX + a, minY + b, minZ + CHUNK_SIZE],
      ];
      candidates.forEach((position) => {
        if (access.peekVoxel(...position) === Voxel.Water) activate(position);
      });
    }
}
