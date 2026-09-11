import type { CorePlatformPorts } from '@seedlands/stdlib/runtime/platform-ports';

const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });

export const browserCorePlatform: CorePlatformPorts = Object.freeze({
  clone: <Value>(value: Value) => structuredClone(value),
  now: () => performance.now(),
  timers: Object.freeze({
    set: (callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs),
    clear: (handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  }),
  createAbortController: () => new AbortController(),
  utf8: Object.freeze({
    encode: (value: string) => encoder.encode(value),
    decodeFatal: (value: Uint8Array) => fatalDecoder.decode(value),
  }),
  yieldTurn: () => new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0)),
});
