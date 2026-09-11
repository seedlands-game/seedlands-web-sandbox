import { expect, it } from 'vitest';
import { parseWasmWorkerName, wasmExperimentWorkerName } from '../../../src/client/compute/wasm-experiment-selection';
it('uses the measured shared kernels by default and preserves explicit TS control', () => {
  expect(wasmExperimentWorkerName('')).toBe('seedlands-wasm:v2:simd:w02,w03,w04,w05,w06');
  expect(wasmExperimentWorkerName('?wasm=off')).toBe('');
  expect(wasmExperimentWorkerName('?wasm=')).toBe('');
  expect(wasmExperimentWorkerName('?wasm=w04&simd=off')).toBe('seedlands-wasm:v2:scalar:w04');
  expect(parseWasmWorkerName('seedlands-wasm:w04,w04,unknown')).toEqual({ artifact: 'simd', kernels: ['w04'] });
  expect(parseWasmWorkerName('seedlands-wasm:v2:scalar:w06,w04,w06')).toEqual({
    artifact: 'scalar',
    kernels: ['w06', 'w04'],
  });
  expect(parseWasmWorkerName('seedlands-wasm:v3:simd:w04')).toEqual({ artifact: 'off', kernels: [] });
});
