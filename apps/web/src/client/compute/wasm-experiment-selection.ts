import {
  sanitizeKernelNames,
  type WasmArtifactPreference,
  type WasmWorkerSelection,
} from '../../compute/wasm-kernel-contract';
import { resolveExperimentalClientOptions, workerSelectionFor } from '../experimental-client-options';

export function encodeWasmWorkerName(selection: WasmWorkerSelection): string {
  if (selection.artifact === 'off' || !selection.kernels.length) return '';
  const kernels = sanitizeKernelNames(selection.kernels).sort();
  return kernels.length ? `seedlands-wasm:v2:${selection.artifact}:${kernels.join(',')}` : '';
}

export function parseWasmWorkerName(name: string): WasmWorkerSelection {
  if (!name) return { artifact: 'off', kernels: [] };
  const legacyPrefix = 'seedlands-wasm:';
  if (!name.startsWith(legacyPrefix)) return { artifact: 'off', kernels: [] };
  const payload = name.slice(legacyPrefix.length);
  if (!payload.startsWith('v2:')) {
    const kernels = sanitizeKernelNames(payload.split(','));
    return { artifact: kernels.length ? 'simd' : 'off', kernels };
  }
  const match = /^v2:(simd|scalar):(.+)$/.exec(payload);
  if (!match) return { artifact: 'off', kernels: [] };
  const artifact = match[1] as WasmArtifactPreference;
  const kernels = sanitizeKernelNames(match[2].split(','));
  return { artifact: kernels.length ? artifact : 'off', kernels };
}

export function wasmExperimentWorkerName(
  input: string | WasmWorkerSelection = globalThis.location?.search ?? '',
): string {
  const selection =
    typeof input === 'string' ? workerSelectionFor(resolveExperimentalClientOptions({ search: input })) : input;
  return encodeWasmWorkerName(selection);
}
