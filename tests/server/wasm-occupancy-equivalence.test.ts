import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { MAX_OCCUPANCY_CELLS, runOccupancyKernel } from '../../apps/web/src/compute/occupancy-kernel';
import { createKernelMemory, WASM_ARENA_BYTES } from '../../apps/web/src/compute/kernel-memory';
import { Voxel } from '../../packages/game-core/src/world/voxel';
import { collisionBoxesForVoxel } from '../../packages/game-core/src/world/voxel-model';

const moduleBytes = () =>
  readFile(new URL('../../apps/web/src/generated/wasm/rust-kernels-scalar.wasm', import.meta.url));
const expectedOccupancy = (voxels: Uint16Array) =>
  Uint8Array.from(voxels, (voxel) => Number(collisionBoxesForVoxel(voxel).length > 0));

describe('W10 Rust Wasm occupancy kernel', () => {
  it('matches collision-box occupancy for every registered voxel and representative unknown ids', async () => {
    const voxels = Uint16Array.from([
      Voxel.Air,
      Voxel.Grass,
      Voxel.Dirt,
      Voxel.Stone,
      Voxel.Wood,
      Voxel.Leaves,
      Voxel.Sand,
      Voxel.Snow,
      Voxel.Water,
      Voxel.Glowstone,
      Voxel.Lantern,
      11,
      255,
      65_535,
    ]);
    const kernel = await createKernelMemory(await moduleBytes());

    expect(runOccupancyKernel(kernel, voxels)).toEqual(expectedOccupancy(voxels));
    expect(kernel.failed).toBe(false);
  });

  it('matches collision-box occupancy for the complete u16 protocol domain and max window capacity', async () => {
    const domain = new Uint16Array(65_536);
    for (let index = 0; index < domain.length; index += 1) domain[index] = index;
    const maxWindow = domain.slice(0, 32 ** 3);
    const kernel = await createKernelMemory(await moduleBytes());
    const firstHalf = domain.slice(0, 32 ** 3);
    const secondHalf = domain.slice(32 ** 3);

    expect(
      Uint8Array.from([...runOccupancyKernel(kernel, firstHalf), ...runOccupancyKernel(kernel, secondHalf)]),
    ).toEqual(expectedOccupancy(domain));
    expect(runOccupancyKernel(kernel, maxWindow)).toEqual(expectedOccupancy(maxWindow));
    expect(kernel.failed).toBe(false);
  });

  it('rejects ABI offsets and counts without trapping, while the adapter rejects an oversized W10 window', async () => {
    const kernel = await createKernelMemory(await moduleBytes());

    expect(kernel.invoke('occupancy', 63, 64, 0)).toBe(-1);
    expect(kernel.invoke('occupancy', 64, WASM_ARENA_BYTES, 1)).toBe(-1);
    expect(kernel.invoke('occupancy', WASM_ARENA_BYTES - 2, 64, 2)).toBe(-1);
    expect(() => runOccupancyKernel(kernel, new Uint16Array(MAX_OCCUPANCY_CELLS + 1))).toThrow(/at most/);
    expect(kernel.failed).toBe(false);
  });
});
