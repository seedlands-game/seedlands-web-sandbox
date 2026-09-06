import { RawCdp, type TargetInfo } from './p0-profiler';

export type WasmWorkerInspection = {
  role: string;
  url: string;
  debugFieldPresent: boolean;
  selected: string[];
  status: 'off' | 'ready' | 'fallback' | 'UNKNOWN';
  reason: string | null;
  memory: null | { failed: boolean; bufferBytes: number | null };
};

const targetRole = (target: TargetInfo): string => {
  if (target.url.includes('authority-worker')) return 'authority';
  if (target.url.includes('game-logic-worker')) return 'logic';
  if (target.url.includes('fluid-compute-worker')) return 'fluid';
  if (target.url.includes('persistence-worker')) return 'persistence';
  if (target.url.includes('world-worker')) return 'general';
  return `unknown-${target.type}`;
};

/** 只按值读取预注册字段；不序列化 KernelMemory 实例或 Wasm exports。 */
export async function inspectWasmWorkers(debugPort: string, origin: string): Promise<WasmWorkerInspection[]> {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  if (!response.ok) throw new Error(`CDP target list returned ${response.status}.`);
  const targets = (await response.json()) as TargetInfo[];
  const inspections: WasmWorkerInspection[] = [];
  for (const target of targets) {
    if (target.type !== 'worker' || !target.webSocketDebuggerUrl || !target.url.startsWith(origin)) continue;
    const client = await RawCdp.connect(target.webSocketDebuggerUrl);
    try {
      const evaluation = await client.send<{
        result: { value?: Omit<WasmWorkerInspection, 'role' | 'url'> };
        exceptionDetails?: { text?: string };
      }>('Runtime.evaluate', {
        expression: `(() => {
          const state = self.__seedlandsWasm;
          if (!state) return {
            debugFieldPresent: false,
            selected: [],
            status: 'UNKNOWN',
            reason: null,
            memory: null,
          };
          const memory = state.memory;
          return {
            debugFieldPresent: true,
            selected: Array.isArray(state.selected) ? [...state.selected] : [],
            status: typeof state.status === 'string' ? state.status : 'UNKNOWN',
            reason: typeof state.reason === 'string' ? state.reason : null,
            memory: memory ? {
              failed: Boolean(memory.failed),
              bufferBytes: memory.memory?.buffer instanceof ArrayBuffer
                ? memory.memory.buffer.byteLength
                : null,
            } : null,
          };
        })()`,
        returnByValue: true,
      });
      if (evaluation.exceptionDetails || !evaluation.result.value)
        throw new Error(evaluation.exceptionDetails?.text ?? 'Worker 诊断字段没有返回值。');
      inspections.push({ role: targetRole(target), url: target.url, ...evaluation.result.value });
    } finally {
      client.close();
    }
  }
  return inspections.sort((left, right) => left.role.localeCompare(right.role) || left.url.localeCompare(right.url));
}
