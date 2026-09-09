import type { KernelDiagnostics } from '../../compute/kernel-memory';

export function readKernelDiagnostics(value: unknown): KernelDiagnostics | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Partial<KernelDiagnostics>;
  if (
    ![data.calls, data.failures, data.memoryBytes].every((number) => Number.isSafeInteger(number) && number! >= 0) ||
    !Number.isFinite(data.durationMs) ||
    data.durationMs! < 0 ||
    typeof data.failed !== 'boolean'
  )
    return null;
  return {
    calls: data.calls!,
    failures: data.failures!,
    memoryBytes: data.memoryBytes!,
    durationMs: data.durationMs!,
    failed: data.failed,
  };
}

export type ComputeWorkerActivity = Readonly<{
  lane: 'fluid' | 'general';
  index: number;
  status: 'starting' | 'idle' | 'busy' | 'unavailable';
  taskId: number | null;
  taskCategory: string | null;
  taskAgeMs: number | null;
  sampledAtMs: number | null;
  completedTasks: number;
  lastTaskDurationMs: number | null;
  kernel: KernelDiagnostics | null;
}>;
