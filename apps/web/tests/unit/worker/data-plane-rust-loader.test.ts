import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { selectRustKernelBytes } from '../../../src/worker/wasm-kernel-loader';
it('selects scalar when SIMD validation fails and validates the scalar fallback', async () => {
  const scalar = new Uint8Array(await readFile('apps/web/src/generated/wasm/rust-kernels-scalar.wasm'));
  const calls: string[] = [];
  const selected = await selectRustKernelBytes('simd', async (mode) => {
    calls.push(mode);
    return mode === 'simd' ? new Uint8Array([0]) : scalar;
  });
  expect(calls).toEqual(['simd', 'scalar']);
  expect(selected).toEqual({ bytes: scalar, artifact: 'scalar' });
});

it('records the SHA-256 of the artifact actually instantiated', async () => {
  const { createHash } = await import('node:crypto');
  const { loadWorkerKernels } = await import('../../../src/worker/wasm-kernel-loader');
  const bytes = new Uint8Array(await readFile('apps/web/src/generated/wasm/rust-kernels-simd.wasm'));
  const state = await loadWorkerKernels({ artifact: 'simd', kernels: ['w06'] }, async () => bytes);
  expect(state.status).toBe('matched');
  expect(state).toHaveProperty('artifactSha256', createHash('sha256').update(bytes).digest('hex'));
});
