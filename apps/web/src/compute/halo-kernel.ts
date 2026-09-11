import { prepareProviderMeshInput, type ProviderMeshInput } from '@seedlands/stdlib/world/provider-mesh-input';
import type { KernelMemory } from './kernel-memory';

const COUNT = 34 ** 3;
const COLUMNS = 64;
const KNOWN = 32768;
const HALO = 262144;
const FLUID = 393216;

export const createHaloStaged = (options: ProviderMeshInput) => prepareProviderMeshInput(options);

export function createHaloKernel(kernel: KernelMemory): typeof createHaloStaged {
  return (options) => {
    if (
      kernel.failed ||
      ![options.cx, options.cy, options.cz].every(
        (coordinate) => Number.isInteger(coordinate) && Math.abs(coordinate) < 2 ** 25,
      )
    )
      return createHaloStaged(options);
    try {
      const prepared = prepareProviderMeshInput(options);
      const known = kernel.u32(KNOWN, COUNT);
      for (let index = 0; index < COUNT; index += 1)
        known[index] = prepared.halo[index] | (prepared.fluidHalo[index] << 16);
      const revision =
        kernel.invoke(
          'fill_halo',
          COLUMNS,
          KNOWN,
          HALO,
          FLUID,
          options.cy * 32 - 1,
          options.seed,
          options.cx * 32 - 1,
          options.cz * 32 - 1,
          options.generatorVersion,
        ) >>> 0;
      return {
        ...prepared,
        halo: kernel.u16(HALO, COUNT).slice(),
        fluidHalo: kernel.bytes(FLUID, COUNT).slice(),
        haloRevision: String(revision),
      };
    } catch {
      kernel.failed = true;
      return createHaloStaged(options);
    }
  };
}
