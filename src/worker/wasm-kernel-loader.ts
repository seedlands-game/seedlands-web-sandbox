import { createKernelMemory, type KernelMemory } from '../compute/kernel-memory';

export const KERNEL_NAMES = ['w02', 'w03', 'w04', 'w05', 'w06', 'w07', 'w10', 'w14', 'w15'] as const;
export type KernelName = (typeof KERNEL_NAMES)[number];
export type WorkerKernelState = {
  memory: KernelMemory | null;
  selected: readonly KernelName[];
  status: 'off' | 'ready' | 'fallback';
  reason?: string;
  artifactSha256?: string;
};

export function parseKernelSelection(name: string): KernelName[] {
  if (!name.startsWith('seedlands-wasm:')) return [];
  return [...new Set(name.slice('seedlands-wasm:'.length).split(','))].filter((value): value is KernelName =>
    KERNEL_NAMES.includes(value as KernelName),
  );
}

export async function selectRustKernelBytes(
  fetchMode: (mode: 'scalar' | 'simd') => Promise<Uint8Array>,
): Promise<Uint8Array> {
  try {
    const simd = await fetchMode('simd');
    if (WebAssembly.validate(Uint8Array.from(simd))) return simd;
  } catch {
    /* The scalar artifact is also an independently supported target. */
  }
  const scalar = await fetchMode('scalar');
  if (!WebAssembly.validate(Uint8Array.from(scalar))) throw new Error('Invalid scalar Rust Wasm artifact.');
  return scalar;
}

const fetchKernelBytes = () =>
  selectRustKernelBytes(async (mode) => {
    const url =
      mode === 'simd'
        ? new URL('../generated/wasm/rust-kernels-simd.wasm', import.meta.url)
        : new URL('../generated/wasm/rust-kernels-scalar.wasm', import.meta.url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Rust Wasm fetch failed: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  });

export async function loadWorkerKernels(
  selected: readonly KernelName[],
  fetchBytes: () => Promise<Uint8Array> = fetchKernelBytes,
): Promise<WorkerKernelState> {
  if (!selected.length) return { memory: null, selected, status: 'off' };
  try {
    const bytes = await fetchBytes();
    const artifactSha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
    const memory = await createKernelMemory(bytes);
    const answer = new TextEncoder().encode('123456789');
    memory.bytes(64, answer.length).set(answer);
    if (memory.invoke('crc32_bytes', 64, answer.length) >>> 0 !== 0xcbf43926)
      throw new Error('Wasm known-answer validation failed.');
    return { memory, selected, status: 'ready', artifactSha256 };
  } catch (error) {
    return {
      memory: null,
      selected,
      status: 'fallback',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
