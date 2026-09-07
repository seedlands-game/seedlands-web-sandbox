import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EXPERIMENTAL_CLIENT_OPTIONS,
  EXPERIMENT_STORAGE_KEY,
  parseStoredExperimentalClientOptions,
  persistExperimentalClientOptions,
  resolveExperimentalClientOptions,
  urlWithoutExperimentalOverride,
  workerSelectionFor,
} from '../../src/client/experimental-client-options';

describe('客户端实验配置', () => {
  it('默认使用 WebGL2、部分 Rust Wasm 和 SIMD artifact', () => {
    const resolved = resolveExperimentalClientOptions();
    expect(resolved.options).toEqual(DEFAULT_EXPERIMENTAL_CLIENT_OPTIONS);
    expect(resolved.kernels).toEqual(['w02', 'w03', 'w04', 'w05', 'w06']);
    expect(workerSelectionFor(resolved)).toEqual({ artifact: 'simd', kernels: resolved.kernels });
  });

  it('按初始化、URL、持久化、默认顺序逐字段覆盖', () => {
    const stored = JSON.stringify({ renderer: 'webgpu', wasm: false, simd: false });
    const resolved = resolveExperimentalClientOptions({
      stored,
      search: '?renderer=webgl2&wasm=w04,w04,garbage&simd=on',
      initialization: { renderer: 'webgpu', simd: false },
    });
    expect(resolved.options).toEqual({ renderer: 'webgpu', wasm: true, simd: false });
    expect(resolved.kernels).toEqual(['w04']);
    expect(resolved.initializationOverrides).toEqual(['renderer', 'simd']);
  });

  it('显式 Wasm 初始化覆盖高级 URL 时恢复默认内核', () => {
    const resolved = resolveExperimentalClientOptions({ search: '?wasm=w04', initialization: { wasm: true } });
    expect(resolved.kernels).toEqual(['w02', 'w03', 'w04', 'w05', 'w06']);
  });

  it('兼容空 Wasm 参数并忽略非法字段和损坏持久化', () => {
    expect(resolveExperimentalClientOptions({ search: '?wasm=' }).options.wasm).toBe(false);
    expect(resolveExperimentalClientOptions({ search: '?wasm=garbage', stored: '{' }).options.wasm).toBe(true);
    expect(parseStoredExperimentalClientOptions(JSON.stringify({ renderer: 'webgl2', wasm: true }))).toEqual({});
  });

  it('保存完整公开配置并只移除定向 URL override', () => {
    const setItem = vi.fn();
    expect(persistExperimentalClientOptions({ setItem }, DEFAULT_EXPERIMENTAL_CLIENT_OPTIONS)).toBe(true);
    expect(setItem).toHaveBeenCalledWith(EXPERIMENT_STORAGE_KEY, JSON.stringify(DEFAULT_EXPERIMENTAL_CLIENT_OPTIONS));
    expect(
      urlWithoutExperimentalOverride('https://seedlands.test/?renderer=webgpu&wasm=w04&harness=1', 'renderer'),
    ).toBe('https://seedlands.test/?wasm=w04&harness=1');
  });
});
