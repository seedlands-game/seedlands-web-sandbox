import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { loadWorkerKernels, parseKernelSelection } from '../../src/worker/wasm-kernel-loader';

describe('Worker Wasm 选择与加载失败回退', () => {
  it('默认关闭，开启项白名单解析；全关不下载模块', async () => {
    const fetchBytes = vi.fn();
    expect(parseKernelSelection('')).toEqual([]);
    expect(parseKernelSelection('seedlands-wasm:w02,w03,unknown,w02')).toEqual(['w02', 'w03']);
    const result = await loadWorkerKernels([], fetchBytes);
    expect(result.memory).toBeNull();
    expect(fetchBytes).not.toHaveBeenCalled();
  });
  it('已知答案验证后才启用，请求失败与坏模块回退', async () => {
    const bytes = await readFile(new URL('../../src/generated/wasm/seedlands-kernels.wasm', import.meta.url));
    const valid = await loadWorkerKernels(['w02'], async () => bytes);
    expect(valid.memory?.failed).toBe(false);
    expect(valid.status).toBe('ready');
    for (const fetchBytes of [
      async () => {
        throw new Error('404');
      },
      async () => new Uint8Array([0]),
    ]) {
      const fallback = await loadWorkerKernels(['w02'], fetchBytes);
      expect(fallback.memory).toBeNull();
      expect(fallback.status).toBe('fallback');
      expect(fallback.reason).toBeTruthy();
    }
  });
});
