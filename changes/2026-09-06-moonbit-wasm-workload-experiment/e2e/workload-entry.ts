import { makeWorkloadCorpus, type WorkloadId, type WorkloadInput } from './workload-corpus';
import type { WorkloadMode } from './workload-worker';

type Response = {
  id: number;
  result?: unknown;
  error?: string;
  failed?: boolean;
  computeMs?: number;
  kernelMs?: number;
  memoryBytes: number;
  outputBytes?: number;
  initializationMs?: number;
};
export type TaskSample = {
  prepareMs: number;
  roundtripMs: number;
  endToEndMs: number;
  computeMs: number;
  kernelMs: number;
  inputBytes: number;
  outputBytes: number;
  memoryBytes: number;
  digest: number;
};
const worker = new Worker(new URL('./workload-worker.ts', import.meta.url), { type: 'module' });
let sequence = 0;
const pending = new Map<number, { resolve: (message: Response) => void; reject: (error: Error) => void }>();
worker.onmessage = (event: MessageEvent<Response>) => {
  const task = pending.get(event.data.id);
  pending.delete(event.data.id);
  if (event.data.error || event.data.failed)
    task?.reject(new Error(event.data.error ?? 'Wasm fallback invalidates sample.'));
  else task?.resolve(event.data);
};
worker.onerror = (event) => {
  for (const task of pending.values()) task.reject(new Error(event.message));
  pending.clear();
};

const transferredBuffers = (value: unknown, found = new Set<ArrayBuffer>()): ArrayBuffer[] => {
  if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) found.add(value.buffer);
  else if (value instanceof ArrayBuffer) found.add(value);
  else if (value && typeof value === 'object')
    for (const child of Object.values(value)) transferredBuffers(child, found);
  return [...found];
};

const send = (input?: WorkloadInput, mode?: WorkloadMode) =>
  new Promise<Response>((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, input, mode }, transferredBuffers(input));
  });

function digest(value: unknown): number {
  let hash = 2166136261;
  const encoder = new TextEncoder();
  const bytes = (data: Uint8Array) => {
    for (const byte of data) hash = Math.imul(hash ^ byte, 16777619);
  };
  const visit = (item: unknown): void => {
    if (ArrayBuffer.isView(item)) bytes(new Uint8Array(item.buffer, item.byteOffset, item.byteLength));
    else if (item && typeof item === 'object')
      for (const key of Object.keys(item).sort()) {
        if (key === 'macroContextCount') continue;
        bytes(encoder.encode(key));
        visit((item as Record<string, unknown>)[key]);
      }
    else bytes(encoder.encode(String(item)));
  };
  visit(value);
  return hash >>> 0;
}

const initialization = send();
const corpora = new Map<WorkloadId, WorkloadInput[]>();
const expectedDigests = new Map<WorkloadId, number[]>();

async function task(input: WorkloadInput, mode: WorkloadMode): Promise<TaskSample> {
  const preparationStarted = performance.now();
  const copied = structuredClone(input);
  const inputBytes = transferredBuffers(copied).reduce((sum, buffer) => sum + buffer.byteLength, 0);
  const dispatchStarted = performance.now();
  const result = await send(copied, mode);
  const finished = performance.now();
  return {
    prepareMs: dispatchStarted - preparationStarted,
    roundtripMs: finished - dispatchStarted,
    endToEndMs: finished - preparationStarted,
    computeMs: result.computeMs ?? 0,
    kernelMs: result.kernelMs ?? 0,
    inputBytes,
    outputBytes: result.outputBytes ?? 0,
    memoryBytes: result.memoryBytes,
    digest: digest(result.result),
  };
}

export async function prepareWorkload(id: WorkloadId) {
  const initialized = await initialization;
  const corpus = makeWorkloadCorpus(id);
  corpora.set(id, corpus);
  const hashes: number[] = [];
  for (const input of corpus) hashes.push((await task(input, 'ts')).digest);
  expectedDigests.set(id, hashes);
  return {
    ...initialized,
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    timeOrigin: performance.timeOrigin,
  };
}

export async function sampleWorkload(id: WorkloadId, mode: WorkloadMode, warmupMs = 5000, count = 30) {
  const corpus = corpora.get(id);
  const expected = expectedDigests.get(id);
  if (!corpus || !expected) throw new Error('Workload corpus was not prepared.');
  const started = performance.now();
  let warmups = 0;
  while (warmups < 20 || performance.now() - started < warmupMs) {
    const index = warmups++ % corpus.length;
    const result = await task(corpus[index], mode);
    if (result.digest !== expected[index]) throw new Error(`${id}/${mode} warmup correctness mismatch.`);
  }
  const samples: TaskSample[] = [];
  for (let index = 0; index < count; index += 1) {
    const result = await task(corpus[index % corpus.length], mode);
    if (result.digest !== expected[index % corpus.length])
      throw new Error(`${id}/${mode} correctness mismatch at ${index}.`);
    samples.push(result);
  }
  return {
    id,
    mode,
    warmups,
    samples,
    visibility: document.visibilityState,
    crossOriginIsolated,
    hardwareConcurrency: navigator.hardwareConcurrency,
  };
}

export function disposeWorkload() {
  worker.terminate();
}
