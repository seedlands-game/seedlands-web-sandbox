export const CORE_PACKAGE: 'world-kernels';
export const WASM_ADAPTER_PACKAGE: 'world-kernels-wasm';
export type CargoMetadata = {
  packages?: { name: string; id: string; dependencies?: { name: string }[] }[];
  resolve?: { nodes?: { id: string; dependencies?: (string | { pkg?: string; id?: string })[] }[] };
};
export type BoundaryResult = { ok: boolean; violations: string[]; coreReachable: string[] };
export function auditRustKernelBoundary(input: {
  metadata: CargoMetadata;
  coreSource?: string;
  adapterSource?: string;
  corePackage?: string;
  adapterPackage?: string;
}): BoundaryResult;
export function checkRustKernelBoundary(input?: { rootDir?: string }): BoundaryResult;
