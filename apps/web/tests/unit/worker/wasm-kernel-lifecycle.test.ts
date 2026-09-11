import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createKernelMemory, KernelMemory, WASM_ARENA_BYTES } from '../../../src/compute/kernel-memory';

const moduleBytes = () => readFile(new URL('../../../src/generated/wasm/rust-kernels-scalar.wasm', import.meta.url));

describe('Wasm 内存与批量 ABI', () => {
  it('隔离实例、校验ABI并读取标准CRC已知答案', async () => {
    const first = await createKernelMemory(await moduleBytes());
    const second = await createKernelMemory(await moduleBytes());
    const input = new TextEncoder().encode('123456789');
    first.bytes(64, input.length).set(input);
    expect(first.invoke('crc32_bytes', 64, input.length) >>> 0).toBe(0xcbf43926);
    expect(second.bytes(64, input.length)).toEqual(new Uint8Array(input.length));
  });

  it('拒绝溢出、堆区和未对齐视图，允许空末尾区间', async () => {
    const kernel = await createKernelMemory(await moduleBytes());
    expect(() => kernel.bytes(-1, 1)).toThrow();
    expect(() => kernel.bytes(0xfffffff0, 64)).toThrow();
    expect(() => kernel.bytes(WASM_ARENA_BYTES, 1)).toThrow();
    expect(() => kernel.u16(65, 1)).toThrow();
    expect(kernel.bytes(WASM_ARENA_BYTES, 0).length).toBe(0);
  });

  it('memory.grow后创建新视图，旧视图不被缓存', async () => {
    const kernel = await createKernelMemory(await moduleBytes());
    const before = kernel.bytes(64, 1);
    before[0] = 42;
    kernel.memory.grow(1);
    expect(before.byteLength).toBe(0);
    expect(kernel.bytes(64, 1)[0]).toBe(42);
  });

  it('trap之后停用实例，禁止再次调用', async () => {
    const kernel = new KernelMemory({
      memory: new WebAssembly.Memory({ initial: 256, maximum: 256 }),
      abi_version: () => 1,
      arena_bytes: () => WASM_ARENA_BYTES,
      crc32_bytes: () => {
        throw new WebAssembly.RuntimeError('synthetic trap');
      },
    } as WebAssembly.Exports);
    expect(() => kernel.invoke('crc32_bytes', 64, 4)).toThrow(/synthetic trap/);
    expect(kernel.failed).toBe(true);
    expect(() => kernel.invoke('crc32_bytes', 64, 0)).toThrow(/disabled/);
  });

  it('拒绝缺失导出/错误ABI/无效二进制', async () => {
    await expect(createKernelMemory(new Uint8Array([0]))).rejects.toThrow();
    await expect(createKernelMemory(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))).rejects.toThrow(/ABI/);
  });
});
