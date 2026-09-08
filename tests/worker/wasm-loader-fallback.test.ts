import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { loadWorkerKernels, parseKernelSelection } from '../../apps/web/src/worker/wasm-kernel-loader';

describe('Worker Wasm 选择与加载失败回退', () => {
  it('默认关闭，开启项白名单解析；全关不下载模块', async () => {
    const fetchBytes = vi.fn();
    expect(parseKernelSelection('')).toEqual([]);
    expect(parseKernelSelection('seedlands-wasm:w02,w03,unknown,w02')).toEqual(['w02', 'w03']);
    const result = await loadWorkerKernels({ artifact: 'off', kernels: [] }, fetchBytes);
    expect(result.memory).toBeNull();
    expect(fetchBytes).not.toHaveBeenCalled();
  });
  it('已知答案验证后才启用，请求失败与坏模块回退', async () => {
    const bytes = await readFile(
      new URL('../../apps/web/src/generated/wasm/rust-kernels-scalar.wasm', import.meta.url),
    );
    const valid = await loadWorkerKernels({ artifact: 'simd', kernels: ['w02'] }, async () => bytes);
    expect(valid.memory?.failed).toBe(false);
    expect(valid.status).toBe('matched');
    for (const fetchBytes of [
      async () => {
        throw new Error('404');
      },
      async () => new Uint8Array([0]),
    ]) {
      const fallback = await loadWorkerKernels({ artifact: 'scalar', kernels: ['w02'] }, fetchBytes);
      expect(fallback.memory).toBeNull();
      expect(fallback.status).toBe('typescript-fallback');
      expect(fallback.reason).toBeTruthy();
    }
  });

  it('SIMD 关闭不请求 SIMD；SIMD 失败后回退 scalar', async () => {
    const scalar = new Uint8Array(
      await readFile(new URL('../../apps/web/src/generated/wasm/rust-kernels-scalar.wasm', import.meta.url)),
    );
    const scalarOnly = vi.fn(async () => scalar);
    const matched = await loadWorkerKernels({ artifact: 'scalar', kernels: ['w06'] }, scalarOnly);
    expect(scalarOnly).toHaveBeenCalledTimes(1);
    expect(scalarOnly).toHaveBeenCalledWith('scalar');
    expect(matched).toMatchObject({ status: 'matched', effectiveArtifact: 'scalar' });

    const fallbackFetch = vi.fn(async (mode: 'scalar' | 'simd') => (mode === 'simd' ? new Uint8Array([0]) : scalar));
    const fallback = await loadWorkerKernels({ artifact: 'simd', kernels: ['w06'] }, fallbackFetch);
    expect(fallbackFetch.mock.calls.map(([mode]) => mode)).toEqual(['simd', 'scalar']);
    expect(fallback).toMatchObject({ status: 'scalar-fallback', effectiveArtifact: 'scalar' });
  });
});
