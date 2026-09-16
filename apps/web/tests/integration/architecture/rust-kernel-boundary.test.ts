import { describe, expect, it } from 'vitest';
import {
  auditRustKernelBoundary,
  checkRustKernelBoundary,
} from '../../../../../scripts/check-rust-kernel-boundary.mjs';

const metadata = (coreDependencies: string[] = []) => ({
  packages: [
    { name: 'world-kernels', id: 'core', dependencies: coreDependencies.map((name) => ({ name })) },
    { name: 'world-kernels-wasm', id: 'adapter', dependencies: [{ name: 'world-kernels' }] },
    ...coreDependencies.map((name) => ({ name, id: name, dependencies: [] })),
  ],
  resolve: {
    nodes: [
      { id: 'core', dependencies: coreDependencies },
      { id: 'adapter', dependencies: ['core'] },
      ...coreDependencies.map((name) => ({ id: name, dependencies: [] })),
    ],
  },
});

const sources = {
  core: '#![no_std]\npub fn occupancy(input: &[u16], output: &mut [u8]) { for (a, b) in input.iter().zip(output) { *b = u8::from(*a != 0); } }',
  adapter:
    '#![no_std]\nuse core::arch::wasm32::*;\npub fn run(input: &[u16], output: &mut [u8]) { let _ = (input, output); }',
};

describe('Rust 内核依赖与宿主边界治理', () => {
  it('真实 workspace 通过 Cargo 传递依赖和源码边界检查', () => {
    expect(checkRustKernelBoundary({ rootDir: process.cwd() }).ok).toBe(true);
  }, 30_000);

  it('允许纯 Rust slice core 与 wasm32 adapter SIMD', () => {
    const result = auditRustKernelBoundary({
      metadata: metadata(),
      coreSource: sources.core,
      adapterSource: sources.adapter,
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('拒绝 core 的传递宿主依赖，即使 adapter 只依赖 core', () => {
    const result = auditRustKernelBoundary({
      metadata: metadata(['wasm-bindgen']),
      coreSource: sources.core,
      adapterSource: sources.adapter,
    });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toMatch(/wasm-bindgen/);
  });

  it('拒绝未激活的可选宿主依赖，同时允许纯容器路径', () => {
    const graph = metadata();
    const core = graph.packages.find((pkg: { name: string }) => pkg.name === 'world-kernels')!;
    core.dependencies.push({ name: 'napi' });
    expect(auditRustKernelBoundary({ metadata: graph, coreSource: 'use std::collections::BTreeMap;' }).ok).toBe(false);
    expect(auditRustKernelBoundary({ metadata: metadata(), coreSource: 'use std::collections::BTreeMap;' }).ok).toBe(
      true,
    );
  });

  it('拒绝 core 固定 Wasm 地址或宿主 API，同时允许 adapter 使用 wasm32 arch', () => {
    const result = auditRustKernelBoundary({
      metadata: metadata(),
      coreSource: 'use std::net::TcpStream;\nunsafe { core::slice::from_raw_parts(0x1000 as *const u8, 4) };',
      adapterSource: sources.adapter,
    });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toMatch(/std::net|from_raw_parts|固定地址/);
  });
});
