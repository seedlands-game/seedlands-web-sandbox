export type StoredWorldSummary = Readonly<{
  worldId: string;
  seedText: string;
  generatorVersion: number;
  updatedAt: number;
}>;

export async function requestWorldDirectory<Value>(message: Record<string, unknown>): Promise<Value> {
  const worker = new Worker(new URL('../../worker/persistence-worker.ts', import.meta.url), { type: 'module' });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<Value>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('World directory request timed out.')), 10_000);
      worker.onmessage = ({ data }) =>
        data.ok ? resolve(data.result as Value) : reject(new Error(data.error ?? 'World directory request failed.'));
      worker.onerror = (event) => reject(new Error(event.message || 'World directory worker failed.'));
      worker.postMessage({ ...message, requestId: 1 });
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    worker.terminate();
  }
}
