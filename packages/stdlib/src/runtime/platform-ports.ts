export type CoreClone = <Value>(value: Value) => Value;

export type CoreAbortSignal = Readonly<{
  aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: Readonly<{ once?: boolean }>): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}>;

export type CoreAbortController = Readonly<{
  signal: CoreAbortSignal;
  abort(reason?: unknown): void;
}>;

export type CoreTimerPort = Readonly<{
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}>;

export type CoreUtf8Port = Readonly<{
  encode(value: string): Uint8Array;
  decodeFatal(value: Uint8Array): string;
}>;

/**
 * 每个 core 运行实例显式持有的平台能力。调用方必须传入不可变对象，
 * 避免 Worker、child process 或并发测试之间通过可重配全局状态串扰。
 */
export type CorePlatformPorts = Readonly<{
  clone: CoreClone;
  now: () => number;
  timers: CoreTimerPort;
  createAbortController: () => CoreAbortController;
  utf8: CoreUtf8Port;
  yieldTurn: () => Promise<void>;
}>;

export function assertCorePlatformPorts(value: CorePlatformPorts | undefined): CorePlatformPorts {
  if (
    !value ||
    typeof value.clone !== 'function' ||
    typeof value.now !== 'function' ||
    typeof value.timers?.set !== 'function' ||
    typeof value.timers.clear !== 'function' ||
    typeof value.createAbortController !== 'function' ||
    typeof value.utf8?.encode !== 'function' ||
    typeof value.utf8.decodeFatal !== 'function' ||
    typeof value.yieldTurn !== 'function'
  )
    throw new TypeError('Seedlands stdlib requires explicit platform ports.');
  const first = value.now();
  if (!Number.isFinite(first)) throw new TypeError('Seedlands stdlib monotonic clock returned a non-finite value.');
  return value;
}
