import { isSolid } from '../../../src/world/voxel';
import { batchCompactMeshData } from '../../../src/world/mesh-batching';
import { createGenerationControl } from './generation-control';
import {
  makeChunk as oldChunk,
  createProceduralMeshInput as oldHalo,
  meshChunk as oldMesh,
  batchMeshData as oldBatch,
  compactMeshData as oldCompact,
} from '/tmp/seedlands-adoption-baseline/src/world/mesh';
import { computeFluidCandidate as oldFluid } from '/tmp/seedlands-adoption-baseline/src/server/fluid/fluid-transaction';
/// <reference lib="webworker" />
import {
  makeChunk,
  createProceduralMeshInput,
  meshChunk,
  batchMeshData,
  compactMeshData,
} from '../../../src/world/mesh';
import { createStoredChunkRecord as oldStoredRecord } from '/tmp/seedlands-adoption-baseline/src/world/chunk-snapshot-codec';
import { createStoredChunkRecord, crc32Bytes } from '../../../src/world/chunk-snapshot-codec';
import { collisionBoxesForVoxel } from '../../../src/world/voxel-model';
import { computeFluidCandidate, consumeFluidCandidate } from '../../../src/server/fluid/fluid-transaction';
import { createKernelMemory, KernelMemory } from '../../../src/compute/kernel-memory';
import { createFluidControlMemory } from '../../../src/compute/fluid-kernel-control';
import { createMeshPackControlMemory } from '../../../src/compute/mesh-pack-kernel-control';
import { createDenseCodecControl as createCodecControlMemory } from './codec-control';
import { createChunkKernel, makeChunkStaged } from '../../../src/compute/chunk-kernel';
import { createHaloKernel, createHaloStaged } from '../../../src/compute/halo-kernel';
import { createMeshKernelInput, runMeshDescriptorKernel } from '../../../src/compute/mesh-kernel';
import { runMeshDescriptorControl } from '../../../src/compute/mesh-kernel-control';
import { createMeshPackKernel, runMeshPackKernel } from '../../../src/compute/mesh-pack-kernel';
import { createCodecKernel, encodeStoredChunkRecord, runCrc32Bytes } from '../../../src/compute/codec-kernel';
import { runOccupancyKernel } from '../../../src/compute/occupancy-kernel';
import { createFluidKernel } from '../../../src/worker/fluid-kernel';
import type { WorkloadInput } from './workload-corpus';

export type WorkloadMode = 'ts' | 'fixed' | 'staged' | 'moonbit' | 'rust' | 'simd';
const scope = self as DedicatedWorkerGlobalScope;
let memory: KernelMemory;
let coreMemory: KernelMemory;
let simdMemory: KernelMemory;
let kernelMs = 0;
function timed(memory: KernelMemory): KernelMemory {
  const invoke = memory.invoke.bind(memory);
  memory.invoke = (name, ...args) => {
    const started = performance.now();
    try {
      return invoke(name, ...args);
    } finally {
      kernelMs += performance.now() - started;
    }
  };
  return memory;
}
let generationControl: KernelMemory | undefined;
let fluidControl: KernelMemory | undefined;
let packControl: KernelMemory | undefined;
let codecControl: KernelMemory | undefined;
let occupancyControl: KernelMemory | undefined;
const makeOccupancyControl = () => {
  const linear = new WebAssembly.Memory({ initial: 256, maximum: 512 });
  return new KernelMemory({
    memory: linear,
    abi_version: () => 1,
    arena_bytes: () => 16777216,
    occupancy: (input: number, output: number, count: number) => {
      const values = new Uint16Array(linear.buffer, input, count);
      const result = new Uint8Array(linear.buffer, output, count);
      for (let index = 0; index < count; index += 1) result[index] = values[index] === 0 || values[index] === 8 ? 0 : 1;
      return 0;
    },
  });
};
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function run(input: WorkloadInput, mode: WorkloadMode): unknown {
  const wasm = mode === 'moonbit' || mode === 'rust' || mode === 'simd';
  const wasmMemory = mode === 'simd' ? simdMemory : mode === 'rust' ? coreMemory : memory;
  if (mode === 'ts') {
    if (input.kind === 'w02') return oldChunk(...input.args);
    if (input.kind === 'w03') return oldHalo(input.options);
    if (input.kind === 'w04' || input.kind === 'w05') return oldMesh(input.options);
    if (input.kind === 'w06') return oldBatch(input.parts).map(oldCompact);
    if (input.kind === 'w07') return oldFluid(input.snapshot);
  }
  switch (input.kind) {
    case 'w02':
      return (
        wasm
          ? createChunkKernel(wasmMemory)
          : mode === 'staged'
            ? createChunkKernel((generationControl ??= timed(createGenerationControl())))
            : mode === 'fixed'
              ? makeChunkStaged
              : makeChunk
      )(...input.args);
    case 'w03':
      return (
        wasm
          ? createHaloKernel(wasmMemory)
          : mode === 'staged'
            ? createHaloKernel((generationControl ??= timed(createGenerationControl())))
            : mode === 'fixed'
              ? createHaloStaged
              : createProceduralMeshInput
      )(input.options);
    case 'w04':
    case 'w05': {
      if (mode === 'ts' || mode === 'fixed') return meshChunk(input.options);
      const prepared = createMeshKernelInput(input.options);
      return wasm
        ? runMeshDescriptorKernel(wasmMemory, prepared.window, prepared.fluidWindow)
        : runMeshDescriptorControl(prepared.window, prepared.fluidWindow);
    }
    case 'w06':
      return mode !== 'ts' && mode !== 'fixed'
        ? runMeshPackKernel(
            createMeshPackKernel(wasm ? wasmMemory : (packControl ??= timed(createMeshPackControlMemory()))),
            input.parts,
          )
        : mode === 'fixed'
          ? batchCompactMeshData(input.parts)
          : batchMeshData(input.parts).map(compactMeshData);
    case 'w07':
      return mode !== 'ts' && mode !== 'fixed'
        ? createFluidKernel(wasm ? wasmMemory : (fluidControl ??= timed(createFluidControlMemory())), () => {
            throw new Error('Benchmark fluid fallback is forbidden');
          })(input.snapshot)
        : mode === 'fixed'
          ? consumeFluidCandidate(input.snapshot)
          : computeFluidCandidate(input.snapshot);
    case 'w10': {
      if (mode !== 'ts' && mode !== 'fixed')
        return runOccupancyKernel(
          wasm ? wasmMemory : (occupancyControl ??= timed(makeOccupancyControl())),
          input.voxels,
        );
      const output = new Uint8Array(input.voxels.length);
      if (mode === 'fixed') for (let i = 0; i < input.voxels.length; i++) output[i] = Number(isSolid(input.voxels[i]));
      else
        for (let i = 0; i < input.voxels.length; i++)
          output[i] = Number(collisionBoxesForVoxel(input.voxels[i]).length > 0);
      return output;
    }
    case 'w14':
      return mode !== 'ts' && mode !== 'fixed'
        ? encodeStoredChunkRecord(
            createCodecKernel(wasm ? wasmMemory : (codecControl ??= timed(createCodecControlMemory()))),
            input.record,
          )
        : (mode === 'ts' ? oldStoredRecord : createStoredChunkRecord)(input.record);
    case 'w15': {
      if (wasm) return runCrc32Bytes(createCodecKernel(wasmMemory), input.bytes);
      if (mode === 'staged')
        return runCrc32Bytes(createCodecKernel((codecControl ??= timed(createCodecControlMemory()))), input.bytes);
      if (mode === 'fixed') return crc32Bytes(input.bytes);
      let value = 0xffffffff;
      for (const byte of input.bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
      return (value ^ 0xffffffff) >>> 0;
    }
  }
}

function buffers(value: unknown, result = new Set<ArrayBuffer>()): ArrayBuffer[] {
  if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) result.add(value.buffer);
  else if (value instanceof ArrayBuffer) result.add(value);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) buffers(item, result);
  return [...result];
}

scope.onmessage = async (event: MessageEvent<{ id: number; input?: WorkloadInput; mode?: WorkloadMode }>) => {
  const { id, input, mode = 'ts' } = event.data;
  try {
    if (!input) {
      const start = performance.now();
      const response = await fetch(new URL('../../../src/generated/wasm/seedlands-kernels.wasm', import.meta.url));
      memory = timed(await createKernelMemory(new Uint8Array(await response.arrayBuffer())));
      coreMemory = timed(
        await createKernelMemory(
          new Uint8Array(
            await (await fetch(new URL('../evidence/kernels-scalar.wasm', import.meta.url))).arrayBuffer(),
          ),
        ),
      );
      simdMemory = timed(
        await createKernelMemory(
          new Uint8Array(await (await fetch(new URL('../evidence/kernels-simd.wasm', import.meta.url))).arrayBuffer()),
        ),
      );
      scope.postMessage({
        id,
        initializationMs: performance.now() - start,
        memoryBytes:
          mode === 'rust' || mode === 'simd' ? coreMemory.memory.buffer.byteLength : memory.memory.buffer.byteLength,
      });
      return;
    }
    const started = performance.now();
    kernelMs = 0;
    const result = run(input, mode);
    const computeMs = performance.now() - started;
    const transfers = buffers(result);
    scope.postMessage(
      {
        id,
        result,
        computeMs,
        kernelMs,
        failed: memory.failed || coreMemory.failed || simdMemory.failed,
        outputBytes: transfers.reduce((sum, buffer) => sum + buffer.byteLength, 0),
        memoryBytes:
          mode === 'rust' || mode === 'simd' ? coreMemory.memory.buffer.byteLength : memory.memory.buffer.byteLength,
      },
      transfers,
    );
  } catch (error) {
    scope.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
      failed: memory?.failed ?? false,
    });
  }
};
