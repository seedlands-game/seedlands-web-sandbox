import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('旧实验 Wasm 实现清理门禁', () => {
  it('不再保留旧源码、工具链、产物和包命令', () => {
    for (const path of [
      'wasm/seedlands-kernels',
      'wasm/toolchain-lock.json',
      'scripts/build-wasm.mjs',
      'scripts/check-wasm.mjs',
      'scripts/moonbit-toolchain.mjs',
      'scripts/wasm-artifact.mjs',
      'src/generated/wasm/seedlands-kernels.wasm',
      'src/generated/wasm/manifest.json',
    ])
      expect(existsSync(resolve(root, path)), path).toBe(false);

    const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts).not.toHaveProperty('wasm:build');
    expect(packageJson.scripts).not.toHaveProperty('wasm:check');
    expect(packageJson.scripts).not.toHaveProperty('wasm:verify');
  });

  it('保留 Rust scalar/SIMD 生产构建与校验面', () => {
    for (const path of [
      'crates/world-kernels',
      'scripts/rust-kernel-artifact.mjs',
      'src/generated/wasm/rust-kernels-scalar.wasm',
      'src/generated/wasm/rust-kernels-simd.wasm',
      'src/generated/wasm/rust-kernel-manifest.json',
    ])
      expect(existsSync(resolve(root, path)), path).toBe(true);

    const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts['wasm:rust:build']).toBeTruthy();
    expect(packageJson.scripts['wasm:rust:verify']).toBeTruthy();
  });
});
