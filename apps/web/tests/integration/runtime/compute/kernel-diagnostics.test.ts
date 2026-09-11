import { describe, expect, it } from 'vitest';
import { KernelMemory, WASM_ARENA_BYTES } from '../../../../src/compute/kernel-memory';

describe('Wasm 调试计数', () => {
  it('按真实调用记录同步耗时与线性内存，增长后读取当前容量', () => {
    let time = 0;
    const memory = new WebAssembly.Memory({ initial: 256, maximum: 257 });
    const kernel = new KernelMemory(
      { memory, abi_version: () => 1, arena_bytes: () => WASM_ARENA_BYTES, work: () => (time += 3) },
      () => time,
    );
    expect(kernel.diagnostics()).toMatchObject({ calls: 0, durationMs: 0, memoryBytes: WASM_ARENA_BYTES });
    kernel.invoke('work');
    memory.grow(1);
    expect(kernel.diagnostics()).toEqual({
      calls: 1,
      durationMs: 3,
      failures: 0,
      memoryBytes: WASM_ARENA_BYTES + 65_536,
      failed: false,
    });
  });

  it('保留 trap 计数，已停用实例不会被记录成新执行', () => {
    const kernel = new KernelMemory({
      memory: new WebAssembly.Memory({ initial: 256 }),
      abi_version: () => 1,
      arena_bytes: () => WASM_ARENA_BYTES,
      work: () => {
        throw new WebAssembly.RuntimeError('trap');
      },
    });
    expect(() => kernel.invoke('work')).toThrow('trap');
    expect(() => kernel.invoke('work')).toThrow('disabled');
    expect(kernel.diagnostics()).toMatchObject({ calls: 1, failures: 1, failed: true });
  });
});
