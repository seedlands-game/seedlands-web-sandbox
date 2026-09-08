import type { CorePlatformPorts } from '../../packages/game-core/src/runtime/platform-ports';
import { performance } from 'node:perf_hooks';
import { setTimeout as yieldTimeout } from 'node:timers/promises';

const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });

export const testCorePlatform: CorePlatformPorts = Object.freeze({
  clone: <Value>(value: Value) => structuredClone(value),
  now: () => performance.now(),
  timers: Object.freeze({
    set: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
    clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }),
  createAbortController: () => new AbortController(),
  utf8: Object.freeze({
    encode: (value: string) => encoder.encode(value),
    decodeFatal: (value: Uint8Array) => fatalDecoder.decode(value),
  }),
  yieldTurn: async () => {
    await yieldTimeout(0);
  },
});
