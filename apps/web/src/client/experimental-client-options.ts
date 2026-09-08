import {
  DEFAULT_WASM_KERNELS,
  sanitizeKernelNames,
  type KernelName,
  type WasmWorkerSelection,
} from '../compute/wasm-kernel-contract';

export type ExperimentalRenderer = 'webgl2' | 'webgpu';

export type ExperimentalClientOptions = Readonly<{
  renderer: ExperimentalRenderer;
  wasm: boolean;
  simd: boolean;
}>;

export type ExperimentalOptionField = keyof ExperimentalClientOptions;

export type ResolvedExperimentalClientOptions = Readonly<{
  options: ExperimentalClientOptions;
  kernels: readonly KernelName[];
  initializationOverrides: readonly ExperimentalOptionField[];
}>;

export const EXPERIMENT_STORAGE_KEY = 'seedlands.experiments.v1';
export const DEFAULT_EXPERIMENTAL_CLIENT_OPTIONS: ExperimentalClientOptions = Object.freeze({
  renderer: 'webgl2',
  wasm: true,
  simd: true,
});

const isRenderer = (value: unknown): value is ExperimentalRenderer => value === 'webgl2' || value === 'webgpu';

function sanitizePartial(value: unknown): Partial<ExperimentalClientOptions> {
  if (!value || typeof value !== 'object') return {};
  const candidate = value as Record<string, unknown>;
  return {
    ...(isRenderer(candidate.renderer) ? { renderer: candidate.renderer } : {}),
    ...(typeof candidate.wasm === 'boolean' ? { wasm: candidate.wasm } : {}),
    ...(typeof candidate.simd === 'boolean' ? { simd: candidate.simd } : {}),
  };
}

export function parseStoredExperimentalClientOptions(raw: string | null): Partial<ExperimentalClientOptions> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    const sanitized = sanitizePartial(parsed);
    return Object.keys(sanitized).length === 3 ? sanitized : {};
  } catch {
    return {};
  }
}

function parseUrlOverrides(search: string): {
  options: Partial<ExperimentalClientOptions>;
  kernels?: readonly KernelName[];
} {
  const parameters = new URLSearchParams(search);
  const options: {
    renderer?: ExperimentalRenderer;
    wasm?: boolean;
    simd?: boolean;
  } = {};
  const renderer = parameters.get('renderer');
  if (isRenderer(renderer)) options.renderer = renderer;
  const simd = parameters.get('simd');
  if (simd === 'on' || simd === 'off') options.simd = simd === 'on';
  let kernels: readonly KernelName[] | undefined;
  if (parameters.has('wasm')) {
    const wasm = parameters.get('wasm') ?? '';
    if (wasm === '' || wasm === 'off') options.wasm = false;
    else if (wasm === 'on') options.wasm = true;
    else {
      const selected = sanitizeKernelNames(wasm.split(','));
      if (selected.length) {
        options.wasm = true;
        kernels = selected;
      }
    }
  }
  return { options, ...(kernels ? { kernels } : {}) };
}

export function resolveExperimentalClientOptions(
  input: {
    search?: string;
    stored?: string | null;
    initialization?: Partial<ExperimentalClientOptions>;
  } = {},
): ResolvedExperimentalClientOptions {
  const stored = parseStoredExperimentalClientOptions(input.stored ?? null);
  const url = parseUrlOverrides(input.search ?? '');
  const initialization = sanitizePartial(input.initialization);
  const options = Object.freeze({
    ...DEFAULT_EXPERIMENTAL_CLIENT_OPTIONS,
    ...stored,
    ...url.options,
    ...initialization,
  });
  const initializationOverrides = Object.keys(initialization) as ExperimentalOptionField[];
  const explicitWasm = Object.hasOwn(initialization, 'wasm');
  const kernels = options.wasm ? (explicitWasm || !url.kernels ? DEFAULT_WASM_KERNELS : url.kernels) : [];
  return Object.freeze({
    options,
    kernels: Object.freeze([...kernels]),
    initializationOverrides: Object.freeze(initializationOverrides),
  });
}

export function persistExperimentalClientOptions(
  storage: Pick<Storage, 'setItem'>,
  options: ExperimentalClientOptions,
): boolean {
  try {
    storage.setItem(EXPERIMENT_STORAGE_KEY, JSON.stringify(options));
    return true;
  } catch {
    return false;
  }
}

export function readStoredExperimentalClientOptions(storage: Pick<Storage, 'getItem'>): string | null {
  try {
    return storage.getItem(EXPERIMENT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function urlWithoutExperimentalOverride(href: string, field: ExperimentalOptionField): string {
  const url = new URL(href);
  url.searchParams.delete(field === 'renderer' ? 'renderer' : field);
  return url.toString();
}

export function workerSelectionFor(options: ResolvedExperimentalClientOptions): WasmWorkerSelection {
  return {
    artifact: options.options.wasm ? (options.options.simd ? 'simd' : 'scalar') : 'off',
    kernels: options.options.wasm ? options.kernels : [],
  };
}
