import { createHaloKernel, createHaloStaged } from '../compute/halo-kernel';
import { createMeshKernelInput, runMeshDescriptorKernel } from '../compute/mesh-kernel';
import { createMeshPackKernel, runMeshPackKernel } from '../compute/mesh-pack-kernel';
import { meshChunk } from '@seedlands/stdlib/world/mesh';
import { batchCompactMeshData } from '@seedlands/stdlib/world/mesh-batching';
import type { WorldComputeKernels } from '@seedlands/stdlib/server/compute/world-compute-task';
import type { WorkerKernelState } from './wasm-kernel-loader';
import { createWorldgenProviderRegistry } from '@seedlands/kernel/spatial';
import type { KernelWorldgenProvider } from '@seedlands/kernel/spatial';

export function worldKernelAdapter(
  state: WorkerKernelState,
  worldgenProvider: KernelWorldgenProvider,
): WorldComputeKernels {
  const { memory, selected } = state;
  const kernels: WorldComputeKernels = {
    providers: createWorldgenProviderRegistry([worldgenProvider]),
    prepareHalo: createHaloStaged,
    now: () => performance.now(),
  };
  if (!memory) return kernels;
  if (selected.includes('w03')) kernels.prepareHalo = createHaloKernel(memory);
  if (selected.includes('w04') || selected.includes('w05'))
    kernels.meshChunk = (options) => {
      if (memory.failed || !options.semantics) return meshChunk(options);
      try {
        const input = createMeshKernelInput(options);
        return runMeshDescriptorKernel(memory, input.window, input.fluidWindow, options.semantics);
      } catch {
        memory.failed = true;
        return meshChunk(options);
      }
    };
  if (selected.includes('w06')) {
    const pack = createMeshPackKernel(memory);
    kernels.packMeshes = (meshes) => {
      const parts = Object.values(meshes);
      if (!memory.failed)
        try {
          return runMeshPackKernel(pack, parts);
        } catch {
          memory.failed = true;
        }
      return batchCompactMeshData(parts);
    };
  }
  return kernels;
}
