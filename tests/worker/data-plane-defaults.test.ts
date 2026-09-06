import { expect, it } from 'vitest';
import { wasmExperimentWorkerName } from '../../src/client/wasm-experiment-selection';
it('uses the measured shared kernels by default and preserves explicit TS control', () => {
  expect(wasmExperimentWorkerName('')).toBe('seedlands-wasm:w02,w03,w04,w05,w06');
  expect(wasmExperimentWorkerName('?wasm=off')).toBe('');
  expect(wasmExperimentWorkerName('?wasm=')).toBe('');
  expect(wasmExperimentWorkerName('?wasm=w04')).toBe('seedlands-wasm:w04');
});
