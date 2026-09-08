import { createChunkKernel, makeChunkStaged } from '../compute/chunk-kernel';
import { createHaloKernel, createHaloStaged } from '../compute/halo-kernel';
import { createMeshKernelInput, runMeshDescriptorKernel } from '../compute/mesh-kernel';
import { createMeshPackKernel, runMeshPackKernel } from '../compute/mesh-pack-kernel';
import { meshChunk } from '@seedlands/game-core/world/mesh';
import { batchCompactMeshData } from '@seedlands/game-core/world/mesh-batching';
import type { WorldComputeKernels } from '@seedlands/game-core/compute/world-compute-task';
import type { WorkerKernelState } from './wasm-kernel-loader';

export function worldKernelAdapter(state: WorkerKernelState): WorldComputeKernels {
  const { memory, selected } = state;
  const kernels: WorldComputeKernels = {
    makeChunk: makeChunkStaged,
    prepareHalo: createHaloStaged,
    now: () => performance.now(),
  };
  if (!memory) return kernels;
  if (selected.includes('w02')) kernels.makeChunk = createChunkKernel(memory);
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
