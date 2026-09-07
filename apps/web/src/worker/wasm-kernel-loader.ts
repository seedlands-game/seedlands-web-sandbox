import { createKernelMemory, type KernelMemory } from '../compute/kernel-memory';
import {
  type KernelName,
  type WasmArtifactPreference,
  type WasmWorkerSelection,
} from '../compute/wasm-kernel-contract';
import { parseWasmWorkerName } from '../client/compute/wasm-experiment-selection';

export type WorkerKernelState = Readonly<{
  memory: KernelMemory | null;
  selected: readonly KernelName[];
  status: 'off' | 'matched' | 'scalar-fallback' | 'typescript-fallback';
  requestedArtifact: WasmArtifactPreference;
  effectiveArtifact: 'simd' | 'scalar' | 'typescript' | 'off';
  reason?: string;
  artifactSha256?: string;
}>;

export const workerKernelReadyState = ({
  status,
  requestedArtifact,
  effectiveArtifact,
  selected,
  reason,
  artifactSha256,
}: WorkerKernelState) => ({
  status,
  requestedArtifact,
  effectiveArtifact,
  selected,
  ...(reason ? { reason } : {}),
  ...(artifactSha256 ? { artifactSha256 } : {}),
});

export const parseKernelSelection = (name: string): KernelName[] => [...parseWasmWorkerName(name).kernels];

export async function selectRustKernelBytes(
  preference: Exclude<WasmArtifactPreference, 'off'>,
  fetchMode: (mode: 'scalar' | 'simd') => Promise<Uint8Array>,
): Promise<Readonly<{ bytes: Uint8Array; artifact: 'scalar' | 'simd' }>> {
  if (preference === 'simd') {
    try {
      const bytes = await fetchMode('simd');
      if (WebAssembly.validate(Uint8Array.from(bytes))) return { bytes, artifact: 'simd' };
    } catch {
      /* Scalar is the supported fallback. */
    }
  }
  const bytes = await fetchMode('scalar');
  if (!WebAssembly.validate(Uint8Array.from(bytes))) throw new Error('Invalid scalar Rust Wasm artifact.');
  return { bytes, artifact: 'scalar' };
}

const fetchKernelBytes = async (mode: 'scalar' | 'simd') => {
  const url =
    mode === 'simd'
      ? new URL('../generated/wasm/rust-kernels-simd.wasm', import.meta.url)
      : new URL('../generated/wasm/rust-kernels-scalar.wasm', import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Rust Wasm fetch failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

async function instantiate(bytes: Uint8Array): Promise<Readonly<{ memory: KernelMemory; artifactSha256: string }>> {
  const artifactSha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  const memory = await createKernelMemory(bytes);
  const answer = new TextEncoder().encode('123456789');
  memory.bytes(64, answer.length).set(answer);
  if (memory.invoke('crc32_bytes', 64, answer.length) >>> 0 !== 0xcbf43926)
    throw new Error('Wasm known-answer validation failed.');
  return { memory, artifactSha256 };
}

export async function loadWorkerKernels(
  selection: WasmWorkerSelection | readonly KernelName[],
  fetchMode: (mode: 'scalar' | 'simd') => Promise<Uint8Array> = fetchKernelBytes,
): Promise<WorkerKernelState> {
  const normalized: WasmWorkerSelection =
    'artifact' in selection ? selection : { artifact: selection.length ? 'simd' : 'off', kernels: selection };
  if (normalized.artifact === 'off' || !normalized.kernels.length)
    return {
      memory: null,
      selected: normalized.kernels,
      status: 'off',
      requestedArtifact: normalized.artifact,
      effectiveArtifact: 'off',
      ...(!normalized.kernels.length && normalized.artifact !== 'off' ? { reason: 'no-selected-kernel' } : {}),
    };
  const modes: Array<'simd' | 'scalar'> = normalized.artifact === 'simd' ? ['simd', 'scalar'] : ['scalar'];
  let lastError: unknown;
  for (const mode of modes) {
    try {
      const bytes = await fetchMode(mode);
      if (!WebAssembly.validate(Uint8Array.from(bytes))) throw new Error(`Invalid ${mode} Rust Wasm artifact.`);
      const loaded = await instantiate(bytes);
      return {
        memory: loaded.memory,
        selected: normalized.kernels,
        status: normalized.artifact === 'simd' && mode === 'scalar' ? 'scalar-fallback' : 'matched',
        requestedArtifact: normalized.artifact,
        effectiveArtifact: mode,
        artifactSha256: loaded.artifactSha256,
        ...(lastError ? { reason: lastError instanceof Error ? lastError.message : String(lastError) } : {}),
      };
    } catch (error) {
      lastError = error;
    }
  }
  return {
    memory: null,
    selected: normalized.kernels,
    status: 'typescript-fallback',
    requestedArtifact: normalized.artifact,
    effectiveArtifact: 'typescript',
    reason: lastError instanceof Error ? lastError.message : String(lastError),
  };
}
