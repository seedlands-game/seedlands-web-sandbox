import { createChunkKernel, makeChunkStaged } from '../compute/chunk-kernel';
import { createHaloKernel, createHaloStaged } from '../compute/halo-kernel';
import { createMeshKernelInput, runMeshDescriptorKernel } from '../compute/mesh-kernel';
import { createMeshPackKernel, runMeshPackKernel } from '../compute/mesh-pack-kernel';
import { meshChunk } from '@seedlands/stdlib/world/mesh';
import { batchCompactMeshData } from '@seedlands/stdlib/world/mesh-batching';
import type { WorldComputeKernels } from '@seedlands/stdlib/server/compute/world-compute-task';
import type { WorkerKernelState } from './wasm-kernel-loader';
import { createWorldgenProviderRegistry } from '@seedlands/kernel/spatial';
import { createClassicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';

export function worldKernelAdapter(state: WorkerKernelState): WorldComputeKernels {
  const { memory, selected } = state;
  const generateChunk = memory && selected.includes('w02') ? createChunkKernel(memory) : makeChunkStaged;
  const kernels: WorldComputeKernels = {
    providers: createWorldgenProviderRegistry([createClassicWorldgenProvider(generateChunk)]),
    prepareHalo: createHaloStaged,
    now: () => performance.now(),
  };
  if (!memory) return kernels;
  if (selected.includes('w03')) kernels.prepareHalo = createHaloKernel(memory);
  if (selected.includes('w04') || selected.includes('w05'))
    kernels.meshChunk = (options) => {
      if (memory.failed) return meshChunk(options);
      try {
        const input = createMeshKernelInput(options);
        return runMeshDescriptorKernel(memory, input.window, input.fluidWindow);
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
