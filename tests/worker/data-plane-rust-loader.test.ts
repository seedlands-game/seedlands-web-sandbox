import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { selectRustKernelBytes } from '../../src/worker/wasm-kernel-loader';
it('selects scalar when SIMD validation fails and validates the scalar fallback', async () => {
  const scalar = new Uint8Array(await readFile('changes/2026-09-07-data-plane-adoption/evidence/kernels-scalar.wasm'));
  const calls: string[] = [];
  const selected = await selectRustKernelBytes(async (mode) => {
    calls.push(mode);
    return mode === 'simd' ? new Uint8Array([0]) : scalar;
  });
  expect(calls).toEqual(['simd', 'scalar']);
  expect(selected).toEqual(scalar);
});

it('records the SHA-256 of the artifact actually instantiated', async () => {
  const { createHash } = await import('node:crypto');
  const { loadWorkerKernels } = await import('../../src/worker/wasm-kernel-loader');
  const bytes = new Uint8Array(await readFile('src/generated/wasm/rust-kernels-simd.wasm'));
  const state = await loadWorkerKernels(['w06'], async () => bytes);
  expect(state.status).toBe('ready');
  expect(state).toHaveProperty('artifactSha256', createHash('sha256').update(bytes).digest('hex'));
});
