import { createChunkKernel } from '../compute/chunk-kernel';
import { createHaloKernel } from '../compute/halo-kernel';
import { createMeshKernelInput, runMeshDescriptorKernel } from '../compute/mesh-kernel';
import { createMeshPackKernel, runMeshPackKernel } from '../compute/mesh-pack-kernel';
import { batchMeshData, compactMeshData, meshChunk } from '../world/mesh';
import type { WorldComputeKernels } from './world-compute-task';
import type { WorkerKernelState } from './wasm-kernel-loader';

export function worldKernelAdapter(state: WorkerKernelState): WorldComputeKernels {
  const { memory, selected } = state;
  if (!memory) return {};
  const kernels: WorldComputeKernels = {};
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
      return batchMeshData(parts).map(compactMeshData);
    };
  }
  return kernels;
}
