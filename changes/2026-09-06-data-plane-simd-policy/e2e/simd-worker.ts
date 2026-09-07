/// <reference lib="webworker" />
import { createKernelMemory, type KernelMemory } from '../../../src/compute/kernel-memory';
import { createMeshPackKernel, runMeshPackKernel } from '../../../src/compute/mesh-pack-kernel';
import { createMeshPackControlMemory } from '../../../src/compute/mesh-pack-kernel-control';
import { batchMeshData, compactMeshData, type MeshData } from '../../../src/world/mesh';
const scope = self as DedicatedWorkerGlobalScope;
export type Mode = 'ts' | 'staged' | 'scalar' | 'simd';
export type Input =
  | { kind: 'occupancy' | 'uv' | 'colors' | 'indices'; values: Uint16Array | Uint32Array }
  | { kind: 'mesh'; parts: MeshData[] };
const modules = new Map<Mode, KernelMemory>();
const initialized = Promise.all(
  [
    ['scalar', new URL('../evidence/kernels-scalar.wasm', import.meta.url)],
    ['simd', new URL('../evidence/kernels-simd.wasm', import.meta.url)],
  ].map(async ([mode, url]) => {
    const started = performance.now();
    const bytes = await (await fetch(url)).arrayBuffer();
    modules.set(mode as Mode, await createKernelMemory(new Uint8Array(bytes)));
    return { mode, initializationMs: performance.now() - started, bytes: bytes.byteLength };
  }),
);
const OUTPUT = 8 * 1024 * 1024;
function scalar(input: Input): unknown {
  if (input.kind === 'mesh') return batchMeshData(input.parts).map(compactMeshData);
  const values = input.values;
  if (input.kind === 'occupancy') {
    const result = new Uint8Array(values.length);
    for (let i = 0; i < values.length; i++) result[i] = values[i] !== 0 && values[i] !== 8 ? 1 : 0;
    return result;
  }
  if (input.kind === 'colors') {
    const result = new Uint32Array(values.length);
    for (let i = 0; i < values.length; i++) result[i] = (values[i] & 0xffffff) | (5 << 24);
    return result;
  }
  if (input.kind === 'indices') {
    const result = new Uint32Array(values.length);
    let max = 0;
    for (let i = 0; i < values.length; i++) {
      result[i] = (values[i] + 32768) >>> 0;
      max = Math.max(max, result[i]);
    }
    return { values: result, max };
  }
  const result = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const bits = values[i];
    const sign = (bits >>> 16) & 0x8000;
    const exponent = ((bits >>> 23) & 255) - 112;
    result[i] =
      exponent <= 0 ? sign : exponent >= 31 ? sign | 0x7c00 : sign | (exponent << 10) | ((bits & 0x7fffff) >>> 13);
  }
  return result;
}
function invoke(memory: KernelMemory, input: Exclude<Input, { kind: 'mesh' }>) {
  const count = input.values.length;
  if (input.kind === 'occupancy') return memory.invoke('occupancy', 64, OUTPUT, count);
  if (input.kind === 'uv') return memory.invoke('compact_uvs', 64, OUTPUT, count);
  if (input.kind === 'colors') return memory.invoke('pack_color_alpha', 64, OUTPUT, count, 6);
  return memory.invoke('offset_indices', 64, OUTPUT, count, 32768);
}
function run(input: Input, mode: Mode): unknown {
  if (mode === 'ts') return scalar(input);
  if (input.kind === 'mesh') {
    let memory = modules.get(mode);
    if (mode === 'staged' && !memory) {
      memory = createMeshPackControlMemory();
      modules.set(mode, memory);
    }
    if (!memory) throw new Error('missing mesh memory');
    return runMeshPackKernel(createMeshPackKernel(memory), input.parts);
  }
  const memory = modules.get(mode)!;
  memory
    .bytes(64, input.values.byteLength)
    .set(new Uint8Array(input.values.buffer, input.values.byteOffset, input.values.byteLength));
  const result = invoke(memory, input);
  if (result < 0 || (input.kind !== 'indices' && result !== 0)) throw new Error(`invalid status ${result}`);
  if (input.kind === 'occupancy') return memory.bytes(OUTPUT, input.values.length).slice();
  if (input.kind === 'uv') return memory.u16(OUTPUT, input.values.length).slice();
  const values = memory.u32(OUTPUT, input.values.length).slice();
  return input.kind === 'indices' ? { values, max: result >>> 0 } : values;
}
function buffers(value: unknown, found = new Set<ArrayBuffer>()): ArrayBuffer[] {
  if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) found.add(value.buffer);
  else if (value && typeof value === 'object') for (const child of Object.values(value)) buffers(child, found);
  return [...found];
}
scope.onmessage = async (event: MessageEvent<{ id: number; input?: Input; mode?: Mode; micro?: boolean }>) => {
  const { id, input, mode = 'scalar', micro } = event.data;
  try {
    const initialization = await initialized;
    if (!input) {
      scope.postMessage({ id, initialization });
      return;
    }
    if (micro && input.kind !== 'mesh' && mode !== 'ts') {
      const memory = modules.get(mode)!;
      memory.bytes(64, input.values.byteLength).set(new Uint8Array(input.values.buffer));
      const count = Math.max(100, Math.ceil(16_777_216 / Math.max(1, input.values.length)));
      let result = 0;
      const started = performance.now();
      for (let i = 0; i < count; i++) result = invoke(memory, input);
      scope.postMessage({
        id,
        coreMs: (performance.now() - started) / count,
        count,
        result,
        memoryBytes: memory.memory.buffer.byteLength,
      });
      return;
    }
    const started = performance.now();
    const result = run(input, mode);
    const computeMs = performance.now() - started;
    const transferred = buffers(result);
    scope.postMessage(
      {
        id,
        result,
        computeMs,
        outputBytes: transferred.reduce((n, b) => n + b.byteLength, 0),
        memoryBytes: modules.get(mode)?.memory.buffer.byteLength ?? 0,
      },
      transferred,
    );
  } catch (error) {
    scope.postMessage({ id, error: String(error) });
  }
};
