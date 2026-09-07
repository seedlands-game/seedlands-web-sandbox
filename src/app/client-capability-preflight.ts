export type WorkerSupport = 'checking' | 'supported' | 'unsupported';

export type ClientCapabilityState = Readonly<{
  workerSupport: WorkerSupport;
  estimatedCores: number;
  coreEstimateFallback: boolean;
  requiredWorkerCount: number;
  lowCoreWarning: boolean;
  reason?: string;
}>;

type ProbeWorker = Pick<Worker, 'onmessage' | 'onerror' | 'postMessage' | 'terminate'>;

export const requiredWorkerCount = (generalWorkerCount: 1 | 2): 5 | 6 => (4 + generalWorkerCount) as 5 | 6;

export function estimateHardwareCores(value: unknown): Readonly<{ count: number; fallback: boolean }> {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? { count: Math.floor(value), fallback: false }
    : { count: 1, fallback: true };
}

export async function probeModuleWorker(
  options: {
    createWorker?: () => ProbeWorker;
    timeoutMs?: number;
    setTimer?: (callback: () => void, delayMs: number) => number;
    clearTimer?: (handle: number) => void;
  } = {},
): Promise<Readonly<{ supported: boolean; reason?: string }>> {
  if (!options.createWorker && typeof Worker !== 'function')
    return { supported: false, reason: 'Worker API unavailable.' };
  let worker: ProbeWorker | null = null;
  try {
    worker = options.createWorker
      ? options.createWorker()
      : new Worker(new URL('../worker/capability-probe-worker.ts', import.meta.url), { type: 'module' });
    const setTimer =
      options.setTimer ??
      ((callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs) as unknown as number);
    const clearTimer =
      options.clearTimer ??
      ((handle: number) => globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>));
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (result: Readonly<{ supported: boolean; reason?: string }>) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        worker?.terminate();
        worker = null;
        resolve(result);
      };
      const timer = setTimer(
        () => finish({ supported: false, reason: 'Module Worker probe timed out.' }),
        options.timeoutMs ?? 3_000,
      );
      worker!.onmessage = (event) => {
        if (event.data === 'seedlands-worker-ready') finish({ supported: true });
      };
      worker!.onerror = (event) => finish({ supported: false, reason: event.message || 'Module Worker probe failed.' });
      worker!.postMessage('seedlands-worker-probe');
    });
  } catch (error) {
    worker?.terminate();
    return { supported: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function preflightClientCapabilities(
  generalWorkerCount: 1 | 2,
  options: Parameters<typeof probeModuleWorker>[0] & { hardwareConcurrency?: unknown } = {},
): Promise<ClientCapabilityState> {
  const required = requiredWorkerCount(generalWorkerCount);
  const estimated = estimateHardwareCores(options.hardwareConcurrency ?? globalThis.navigator?.hardwareConcurrency);
  const worker = await probeModuleWorker(options);
  return {
    workerSupport: worker.supported ? 'supported' : 'unsupported',
    estimatedCores: estimated.count,
    coreEstimateFallback: estimated.fallback,
    requiredWorkerCount: required,
    lowCoreWarning: estimated.count < required,
    ...(worker.reason ? { reason: worker.reason } : {}),
  };
}
