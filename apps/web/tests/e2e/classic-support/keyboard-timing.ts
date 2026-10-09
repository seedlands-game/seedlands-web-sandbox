import type { Page, TestInfo } from '@playwright/test';

type KeyboardEventObservation = Readonly<{
  code: string;
  type: 'keydown' | 'keyup';
  timeStamp: number;
  observedAtMs: number;
  repeat: boolean;
  trusted: boolean;
  pointerLocked: boolean;
  visibility: string;
}>;

type KeyboardObservation = {
  timeOrigin: number;
  total: number;
  dropped: number;
  events: KeyboardEventObservation[];
};
type KeyboardState = KeyboardObservation & { cleanup(): void };
type DiagnosticWindow = Window & { __seedlandsClassicKeyboardTimingV1?: KeyboardState };
const runs = new WeakMap<Page, Readonly<{ runId: string; sourceSha: string }>>();

/** Optional passive readback of real events; it never produces input or samples a benchmark. */
export async function startClassicKeyboardTiming(
  page: Page,
  info: Pick<TestInfo, 'title'>,
  benchmark: boolean,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  if (env.SEEDLANDS_CLASSIC_KEYBOARD_TIMING !== '1' || !info.title.startsWith('Classic 生产旅程')) return;
  if (benchmark || env.SEEDLANDS_CLASSIC_BENCHMARK === '1')
    throw new Error('Keyboard timing cannot run in a benchmark.');
  const runId = env.SEEDLANDS_HARNESS_RUN_ID;
  const sourceSha = env.SEEDLANDS_SOURCE_SHA;
  if (!runId || !sourceSha) throw new Error('Keyboard timing needs SEEDLANDS_HARNESS_RUN_ID and SEEDLANDS_SOURCE_SHA.');
  if (runs.has(page)) return;
  runs.set(page, { runId, sourceSha });
  try {
    await page.addInitScript(
      ({ capacity }) => {
        const target = window as DiagnosticWindow;
        if (target.__seedlandsClassicKeyboardTimingV1) throw new Error('This document already owns keyboard timing.');
        const codes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space']);
        const options = { passive: true, capture: true } as const;
        const state: KeyboardState = {
          timeOrigin: performance.timeOrigin,
          total: 0,
          dropped: 0,
          events: [],
          cleanup: () => {
            window.removeEventListener('keydown', observe, options);
            window.removeEventListener('keyup', observe, options);
          },
        };
        const observe = (event: KeyboardEvent): void => {
          if (!codes.has(event.code)) return;
          state.total += 1;
          if (state.events.length === capacity) {
            state.events.shift();
            state.dropped += 1;
          }
          state.events.push({
            code: event.code,
            type: event.type as 'keydown' | 'keyup',
            timeStamp: event.timeStamp,
            observedAtMs: performance.now(),
            repeat: event.repeat,
            trusted: event.isTrusted,
            pointerLocked: document.pointerLockElement?.id === 'game',
            visibility: document.visibilityState,
          });
        };
        target.__seedlandsClassicKeyboardTimingV1 = state;
        window.addEventListener('keydown', observe, options);
        window.addEventListener('keyup', observe, options);
      },
      { capacity: 1024 },
    );
  } catch (error) {
    runs.delete(page);
    throw error;
  }
}

export async function stopClassicKeyboardTiming(page: Page, info: Pick<TestInfo, 'attach'>): Promise<void> {
  const run = runs.get(page);
  if (!run) return;
  runs.delete(page);
  const closed = page.isClosed();
  const observation: KeyboardObservation | null = closed
    ? null
    : await page.evaluate(() => {
        const target = window as DiagnosticWindow;
        const state = target.__seedlandsClassicKeyboardTimingV1;
        if (!state) return null;
        const result = {
          timeOrigin: state.timeOrigin,
          total: state.total,
          dropped: state.dropped,
          events: state.events.map((event) => ({ ...event })),
        };
        state.cleanup();
        delete target.__seedlandsClassicKeyboardTimingV1;
        return result;
      });
  await info.attach('classic-keyboard-timing', {
    body: JSON.stringify({
      schemaVersion: 1,
      ...run,
      diagnosticOnly: true,
      eligible: false,
      status: closed ? 'PAGE_CLOSED' : observation ? 'COMPLETE' : 'NOT_STARTED',
      observation,
    }),
    contentType: 'application/json',
  });
}
