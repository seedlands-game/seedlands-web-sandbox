import { createKernelMemory, type KernelMemory } from '../compute/kernel-memory';

export const KERNEL_NAMES = ['w02', 'w03', 'w04', 'w05', 'w06', 'w07', 'w10', 'w14', 'w15'] as const;
export type KernelName = (typeof KERNEL_NAMES)[number];
export type WorkerKernelState = {
  memory: KernelMemory | null;
  selected: readonly KernelName[];
  status: 'off' | 'ready' | 'fallback';
  reason?: string;
};

export function parseKernelSelection(name: string): KernelName[] {
  if (!name.startsWith('seedlands-wasm:')) return [];
  return [...new Set(name.slice('seedlands-wasm:'.length).split(','))].filter((value): value is KernelName =>
    KERNEL_NAMES.includes(value as KernelName),
  );
}

const fetchKernelBytes = async () => {
  const response = await fetch(new URL('../generated/wasm/seedlands-kernels.wasm', import.meta.url));
  if (!response.ok) throw new Error(`Wasm module fetch failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

export async function loadWorkerKernels(
  selected: readonly KernelName[],
  fetchBytes: () => Promise<Uint8Array> = fetchKernelBytes,
): Promise<WorkerKernelState> {
  if (!selected.length) return { memory: null, selected, status: 'off' };
  try {
    const memory = await createKernelMemory(await fetchBytes());
    const answer = new TextEncoder().encode('123456789');
    memory.bytes(64, answer.length).set(answer);
    if (memory.invoke('crc32_bytes', 64, answer.length) >>> 0 !== 0xcbf43926)
      throw new Error('Wasm known-answer validation failed.');
    return { memory, selected, status: 'ready' };
  } catch (error) {
    return {
      memory: null,
      selected,
      status: 'fallback',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
