export const KERNEL_NAMES = ['w02', 'w03', 'w04', 'w05', 'w06', 'w07', 'w10', 'w14', 'w15'] as const;

export type KernelName = (typeof KERNEL_NAMES)[number];

export const DEFAULT_WASM_KERNELS = ['w02', 'w03', 'w04', 'w05', 'w06'] as const satisfies readonly KernelName[];

export type WasmArtifactPreference = 'simd' | 'scalar' | 'off';

export type WasmWorkerSelection = Readonly<{
  artifact: WasmArtifactPreference;
  kernels: readonly KernelName[];
}>;

const KERNEL_SET = new Set<string>(KERNEL_NAMES);

export function sanitizeKernelNames(values: Iterable<string>): KernelName[] {
  return [...new Set(values)].filter((value): value is KernelName => KERNEL_SET.has(value));
}
