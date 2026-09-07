import { KernelMemory, WASM_ARENA_BYTES } from './kernel-memory';

export const MAX_OCCUPANCY_CELLS = 32 ** 3;
export const OCCUPANCY_INPUT_OFFSET = 64;
export const OCCUPANCY_OUTPUT_OFFSET = OCCUPANCY_INPUT_OFFSET + MAX_OCCUPANCY_CELLS * Uint16Array.BYTES_PER_ELEMENT;

const assertOccupancyInput = (voxels: Uint16Array): void => {
  if (!(voxels instanceof Uint16Array) || voxels.length > MAX_OCCUPANCY_CELLS)
    throw new RangeError(`Occupancy input must contain at most ${MAX_OCCUPANCY_CELLS} u16 voxels.`);
  if (OCCUPANCY_OUTPUT_OFFSET + voxels.length > WASM_ARENA_BYTES)
    throw new RangeError('Occupancy output exceeds the Wasm arena.');
};

/**
 * Runs only the pure W10 voxel-to-occupancy classification. The Authority
 * remains responsible for loaded-chunk, key, and revision validation.
 */
export function runOccupancyKernel(kernel: KernelMemory, voxels: Uint16Array): Uint8Array {
  assertOccupancyInput(voxels);
  kernel.u16(OCCUPANCY_INPUT_OFFSET, voxels.length).set(voxels);
  const status = kernel.invoke('occupancy', OCCUPANCY_INPUT_OFFSET, OCCUPANCY_OUTPUT_OFFSET, voxels.length);
  if (status !== 0) throw new Error(`Wasm occupancy kernel rejected ABI input with status ${status}.`);
  return kernel.bytes(OCCUPANCY_OUTPUT_OFFSET, voxels.length).slice();
}
