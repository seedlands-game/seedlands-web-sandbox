/// <reference lib="webworker" />
import {
  makeChunk,
  createProceduralMeshInput,
  meshChunk,
  batchMeshData,
  compactMeshData,
} from '../../../src/world/mesh';
import { createStoredChunkRecord } from '../../../src/world/chunk-snapshot-codec';
import { collisionBoxesForVoxel } from '../../../src/world/voxel-model';
import { computeFluidCandidate } from '../../../src/server/fluid/fluid-transaction';
import { createKernelMemory, KernelMemory } from '../../../src/compute/kernel-memory';
import { createFluidControlMemory } from '../../../src/compute/fluid-kernel-control';
import { createMeshPackControlMemory } from '../../../src/compute/mesh-pack-kernel-control';
import { createCodecControlMemory } from '../../../src/compute/codec-kernel-control';
import { createChunkKernel, makeChunkStaged } from '../../../src/compute/chunk-kernel';
import { createHaloKernel, createHaloStaged } from '../../../src/compute/halo-kernel';
import { createMeshKernelInput, runMeshDescriptorKernel } from '../../../src/compute/mesh-kernel';
import { runMeshDescriptorControl } from '../../../src/compute/mesh-kernel-control';
import { createMeshPackKernel, runMeshPackKernel } from '../../../src/compute/mesh-pack-kernel';
import { createCodecKernel, encodeStoredChunkRecord, runCrc32Bytes } from '../../../src/compute/codec-kernel';
import { runOccupancyKernel } from '../../../src/compute/occupancy-kernel';
import { createFluidKernel } from '../../../src/worker/fluid-kernel';
import type { WorkloadInput } from './workload-corpus';

export type WorkloadMode = 'ts' | 'staged' | 'moonbit' | 'rust';
const scope = self as DedicatedWorkerGlobalScope;
let memory: KernelMemory;
let rustMemory: KernelMemory;
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
  const wasm = mode === 'moonbit' || mode === 'rust';
  const wasmMemory = mode === 'rust' ? rustMemory : memory;
  switch (input.kind) {
    case 'w02':
      return (wasm ? createChunkKernel(wasmMemory) : mode === 'staged' ? makeChunkStaged : makeChunk)(...input.args);
    case 'w03':
      return (wasm ? createHaloKernel(wasmMemory) : mode === 'staged' ? createHaloStaged : createProceduralMeshInput)(
        input.options,
      );
    case 'w04':
    case 'w05': {
      if (mode === 'ts') return meshChunk(input.options);
      const prepared = createMeshKernelInput(input.options);
      return wasm
        ? runMeshDescriptorKernel(wasmMemory, prepared.window, prepared.fluidWindow)
        : runMeshDescriptorControl(prepared.window, prepared.fluidWindow);
    }
    case 'w06':
      return mode !== 'ts'
        ? runMeshPackKernel(
            createMeshPackKernel(wasm ? wasmMemory : (packControl ??= createMeshPackControlMemory())),
            input.parts,
          )
        : batchMeshData(input.parts).map(compactMeshData);
    case 'w07':
      return mode !== 'ts'
        ? createFluidKernel(wasm ? wasmMemory : (fluidControl ??= createFluidControlMemory()))(input.snapshot)
        : computeFluidCandidate(input.snapshot);
    case 'w10':
      return mode !== 'ts'
        ? runOccupancyKernel(wasm ? wasmMemory : (occupancyControl ??= makeOccupancyControl()), input.voxels)
        : Uint8Array.from(input.voxels, (value) => Number(collisionBoxesForVoxel(value).length > 0));
    case 'w14':
      return mode !== 'ts'
        ? encodeStoredChunkRecord(
            createCodecKernel(wasm ? wasmMemory : (codecControl ??= createCodecControlMemory())),
            input.record,
          )
        : createStoredChunkRecord(input.record);
    case 'w15': {
      if (wasm) return runCrc32Bytes(createCodecKernel(wasmMemory), input.bytes);
      if (mode === 'staged')
        return runCrc32Bytes(createCodecKernel((codecControl ??= createCodecControlMemory())), input.bytes);
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
      const rustResponse = await fetch(new URL('../experiments/rust-reference.wasm', import.meta.url));
      rustMemory = timed(await createKernelMemory(new Uint8Array(await rustResponse.arrayBuffer())));
      scope.postMessage({
        id,
        initializationMs: performance.now() - start,
        memoryBytes: memory.memory.buffer.byteLength,
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
        failed: mode === 'rust' ? rustMemory.failed : memory.failed,
        outputBytes: transfers.reduce((sum, buffer) => sum + buffer.byteLength, 0),
        memoryBytes: memory.memory.buffer.byteLength,
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
