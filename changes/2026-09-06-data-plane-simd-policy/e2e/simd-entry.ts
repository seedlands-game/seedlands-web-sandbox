import type { Input, Mode } from './simd-worker';
import { makeWorkloadCorpus } from '../../2026-09-06-moonbit-wasm-workload-experiment/e2e/workload-corpus';
import { meshChunk } from '../../../src/world/mesh';
const worker = new Worker(new URL('./simd-worker.ts', import.meta.url), { type: 'module' });
let id = 0;
type Reply = {
  id: number;
  result?: unknown;
  error?: string;
  computeMs?: number;
  coreMs?: number;
  count?: number;
  memoryBytes: number;
  outputBytes?: number;
  initialization?: unknown;
};
const pending = new Map<number, { resolve: (reply: Reply) => void; reject: (e: Error) => void }>();
worker.onmessage = (event: MessageEvent<Reply>) => {
  const task = pending.get(event.data.id);
  pending.delete(event.data.id);
  if (event.data.error) task?.reject(new Error(event.data.error));
  else task?.resolve(event.data);
};
worker.onerror = (event) => {
  for (const task of pending.values()) task.reject(new Error(event.message));
  pending.clear();
};
function buffers(value: unknown, found = new Set<ArrayBuffer>()): ArrayBuffer[] {
  if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) found.add(value.buffer);
  else if (value && typeof value === 'object') for (const child of Object.values(value)) buffers(child, found);
  return [...found];
}
function send(input?: Input, mode?: Mode, micro = false) {
  return new Promise<Reply>((resolve, reject) => {
    const sequence = ++id;
    pending.set(sequence, { resolve, reject });
    worker.postMessage({ id: sequence, input, mode, micro }, buffers(input));
  });
}
function hash(value: unknown): number {
  let result = 2166136261;
  const encoder = new TextEncoder();
  function visit(item: unknown): void {
    if (ArrayBuffer.isView(item)) {
      for (const byte of new Uint8Array(item.buffer, item.byteOffset, item.byteLength))
        result = Math.imul(result ^ byte, 16777619);
    } else if (item && typeof item === 'object') {
      for (const key of Object.keys(item).sort()) {
        visit(key);
        visit((item as Record<string, unknown>)[key]);
      }
    } else for (const byte of encoder.encode(String(item))) result = Math.imul(result ^ byte, 16777619);
  }
  visit(value);
  return result >>> 0;
}
let corpus: Input[] = [];
let expected: number[] = [];
export async function prepare(name: string) {
  const initialization = await send();
  if (name === 'mesh-natural')
    corpus = makeWorkloadCorpus('w06')
      .filter((input) => input.kind === 'w06')
      .map((input) => ({ kind: 'mesh', parts: input.parts }));
  else if (name === 'mesh-stress') {
    const data = new Uint16Array(32768);
    for (let y = 5; y < 11; y++)
      for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) if ((x + y + z) % 2) data[x + 32 * (z + 32 * y)] = 1;
    const parts = Object.values(meshChunk({ seed: 1, cx: 0, cy: 0, cz: 0, data, changes: [], outside: () => 0 }));
    corpus = [{ kind: 'mesh', parts }];
  } else {
    const [kind, size] = name.split('-');
    const count = Number(size);
    corpus = Array.from({ length: 10 }, (_, seed) => ({
      kind: kind as 'occupancy' | 'uv' | 'colors' | 'indices',
      values:
        kind === 'occupancy'
          ? Uint16Array.from({ length: count }, (_, i) => (i * 17 + seed) % 11)
          : Uint32Array.from({ length: count }, (_, i) =>
              kind === 'uv'
                ? (i * 65537 + seed * 191) >>> 0
                : kind === 'indices'
                  ? i % 65536
                  : (i * 33554467 + seed) >>> 0,
            ),
    }));
  }
  expected = [];
  const legacyFailures: string[] = [];
  for (const [index, input] of corpus.entries()) {
    const reference = input.kind === 'mesh' ? 'staged' : 'ts';
    expected.push(hash((await send(structuredClone(input), reference)).result));
    if (input.kind === 'mesh') {
      try {
        if (hash((await send(structuredClone(input), 'ts')).result) !== expected[index])
          throw new Error('legacy mismatch');
      } catch (error) {
        legacyFailures.push(`${index}: ${error}`);
      }
    }
  }
  for (const mode of ['scalar', 'simd'] as Mode[])
    for (let i = 0; i < corpus.length; i++)
      if (hash((await send(structuredClone(corpus[i]), mode)).result) !== expected[i])
        throw new Error(`${name}/${mode} correctness mismatch ${i}`);
  return {
    initialization,
    legacyFailures,
    tsControl:
      corpus[0].kind === 'mesh'
        ? 'same-layout TS arena control; legacy results separately validated where executable'
        : 'numeric TS loop',
    corpusCount: corpus.length,
    inputBytes: corpus.map((input) => buffers(input).reduce((n, b) => n + b.byteLength, 0)),
    crossOriginIsolated,
    hardwareConcurrency: navigator.hardwareConcurrency,
  };
}
export async function sample(mode: Mode, warmupMs = 5000, events = 1000) {
  async function task(index: number) {
    const input = corpus[index % corpus.length];
    const started = performance.now();
    const copied = structuredClone(input);
    const prepared = performance.now();
    const reply = await send(copied, mode);
    const finished = performance.now();
    if (hash(reply.result) !== expected[index % expected.length]) throw new Error('sample mismatch');
    return {
      prepareMs: prepared - started,
      roundtripMs: finished - prepared,
      endToEndMs: finished - started,
      computeMs: reply.computeMs ?? 0,
      memoryBytes: reply.memoryBytes,
      outputBytes: reply.outputBytes ?? 0,
    };
  }
  let warmed = 0;
  const begin = performance.now();
  while (warmed < 20 || performance.now() - begin < warmupMs) await task(warmed++);
  const samples = [];
  for (let i = 0; i < events; i++) samples.push(await task(i));
  const cores = [];
  if (corpus[0].kind !== 'mesh' && mode !== 'ts')
    for (const input of corpus) cores.push(await send(structuredClone(input), mode, true));
  return { samples, cores, warmed, visibility: document.visibilityState };
}
export function dispose() {
  worker.terminate();
}
