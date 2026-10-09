import type { Page, TestInfo } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startClassicKeyboardTiming, stopClassicKeyboardTiming } from '../../e2e/classic-support/keyboard-timing';

type KeyboardEventListener = (event: {
  code: string;
  type: 'keydown' | 'keyup';
  timeStamp: number;
  repeat: boolean;
  isTrusted: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}) => void;
type ListenerOptions = boolean | Readonly<{ capture?: boolean; passive?: boolean }>;

class FakeDocument {
  visibilityState = 'visible';
  pointerLockElement: { id: string } | null = { id: 'game' };
}

class FakeWindow {
  __seedlandsClassicKeyboardTimingV1?: Record<string, unknown>;
  onkeydown: ((event: Parameters<KeyboardEventListener>[0]) => void) | null = null;
  onkeyup: ((event: Parameters<KeyboardEventListener>[0]) => void) | null = null;
  private readonly listeners = new Map<string, Set<KeyboardEventListener>>();
  readonly addEventListener = vi.fn((type: string, listener: EventListener, options?: ListenerOptions) => {
    expect(options).toEqual({ capture: true, passive: true });
    const entries = this.listeners.get(type) ?? new Set<KeyboardEventListener>();
    entries.add(listener as unknown as KeyboardEventListener);
    this.listeners.set(type, entries);
  });
  readonly removeEventListener = vi.fn((type: string, listener: EventListener, options?: ListenerOptions) => {
    expect(options).toEqual({ capture: true, passive: true });
    this.listeners.get(type)?.delete(listener as unknown as KeyboardEventListener);
  });

  dispatch(
    type: 'keydown' | 'keyup',
    properties: Omit<Parameters<KeyboardEventListener>[0], 'type' | 'preventDefault' | 'stopPropagation'>,
  ) {
    const event = {
      ...properties,
      type,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    (type === 'keydown' ? this.onkeydown : this.onkeyup)?.(event);
    return event;
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

type InitScript = (argument: { capacity: number }) => void;
type AttachOptions = Readonly<{ contentType: string; body: string | Buffer }>;
type AttachmentSpy = ReturnType<typeof vi.fn<(name: string, options: AttachOptions) => Promise<void>>>;

const enabledEnv = {
  SEEDLANDS_CLASSIC_KEYBOARD_TIMING: '1',
  SEEDLANDS_HARNESS_RUN_ID: 'keyboard-timing-124',
  SEEDLANDS_SOURCE_SHA: 'source-sha-124',
};

function fixture(title = 'Classic 生产旅程 V2') {
  let initScript: InitScript | null = null;
  let initArgument: { capacity: number } | null = null;
  let closed = false;
  let now = 0;
  let timeOrigin = 10_000;
  let document = new FakeDocument();
  let windowValue = new FakeWindow();
  const addInitScript = vi.fn(async (script: InitScript, argument: { capacity: number }) => {
    initScript = script;
    initArgument = argument;
  });
  const evaluate = vi.fn(async (callback: (argument?: unknown) => unknown, argument?: unknown) => callback(argument));
  const page = {
    addInitScript,
    evaluate,
    isClosed: () => closed,
  } as unknown as Page;
  const attach: AttachmentSpy = vi.fn(async () => undefined);
  const info = { title, attach } as unknown as Pick<TestInfo, 'title' | 'attach'> & { attach: typeof attach };
  const runDocumentScript = (
    options: {
      origin?: number;
      visibility?: string;
      pointerLocked?: boolean;
      existingState?: Record<string, unknown>;
    } = {},
  ) => {
    document = new FakeDocument();
    document.visibilityState = options.visibility ?? 'visible';
    document.pointerLockElement = options.pointerLocked === false ? null : { id: 'game' };
    windowValue = new FakeWindow();
    if (options.existingState) windowValue.__seedlandsClassicKeyboardTimingV1 = options.existingState;
    timeOrigin = options.origin ?? timeOrigin;
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', windowValue);
    vi.stubGlobal('performance', { timeOrigin, now: () => now });
    if (!initScript || !initArgument) throw new Error('No keyboard timing init script was registered.');
    initScript(initArgument);
    return { document, window: windowValue };
  };
  const setNow = (value: number) => {
    now = value;
  };
  const close = () => {
    closed = true;
  };
  return { page, info, attach, addInitScript, evaluate, runDocumentScript, setNow, close };
}

afterEach(() => vi.unstubAllGlobals());

describe('optional Classic keyboard timing observation', () => {
  it('is disabled by default, skips non-journey titles, and rejects benchmark or missing identity before install', async () => {
    const run = fixture();
    await expect(startClassicKeyboardTiming(run.page, run.info, false, {})).resolves.toBeUndefined();
    await expect(
      startClassicKeyboardTiming(run.page, { title: 'Classic visual rebuild' }, false, enabledEnv),
    ).resolves.toBeUndefined();
    await expect(startClassicKeyboardTiming(run.page, run.info, true, enabledEnv)).rejects.toThrow(/benchmark/i);
    await expect(
      startClassicKeyboardTiming(run.page, run.info, false, { ...enabledEnv, SEEDLANDS_CLASSIC_BENCHMARK: '1' }),
    ).rejects.toThrow(/benchmark/i);
    await expect(
      startClassicKeyboardTiming(run.page, run.info, false, { ...enabledEnv, SEEDLANDS_SOURCE_SHA: undefined }),
    ).rejects.toThrow(/source|run|identity/i);
    await expect(
      startClassicKeyboardTiming(run.page, run.info, false, { ...enabledEnv, SEEDLANDS_HARNESS_RUN_ID: undefined }),
    ).rejects.toThrow(/source|run|identity/i);
    expect(run.addInitScript).not.toHaveBeenCalled();
  });

  it('installs one init script per page and records only whitelisted key edges in a bounded detached snapshot', async () => {
    const run = fixture();
    await startClassicKeyboardTiming(run.page, run.info, false, enabledEnv);
    await startClassicKeyboardTiming(run.page, run.info, false, enabledEnv);
    expect(run.addInitScript).toHaveBeenCalledTimes(1);
    expect(run.addInitScript.mock.calls[0]?.[1]).toEqual({ capacity: 1024 });

    const { window } = run.runDocumentScript({ origin: 12_345, pointerLocked: true });
    const gameplayKeyDown = vi.fn();
    window.onkeydown = gameplayKeyDown;
    const hidden = window.dispatch('keydown', {
      code: 'F3',
      timeStamp: 1,
      repeat: false,
      isTrusted: false,
    });
    expect(hidden.preventDefault).not.toHaveBeenCalled();
    expect(hidden.stopPropagation).not.toHaveBeenCalled();
    run.setNow(12.5);
    const first = window.dispatch('keydown', {
      code: 'KeyW',
      timeStamp: 22.25,
      repeat: true,
      isTrusted: false,
    });
    expect(first.preventDefault).not.toHaveBeenCalled();
    expect(first.stopPropagation).not.toHaveBeenCalled();
    expect(gameplayKeyDown).toHaveBeenCalledTimes(2);
    run.setNow(13.5);
    window.dispatch('keyup', {
      code: 'Space',
      timeStamp: 23.75,
      repeat: false,
      isTrusted: false,
    });
    for (let index = 0; index < 1_024; index += 1) {
      run.setNow(20 + index);
      window.dispatch(index % 2 ? 'keyup' : 'keydown', {
        code: ['KeyA', 'KeyS', 'KeyD', 'Space'][index % 4]!,
        timeStamp: 100 + index,
        repeat: index % 3 === 0,
        isTrusted: false,
      });
    }

    const state = window.__seedlandsClassicKeyboardTimingV1;
    expect(state).toBeDefined();
    expect(state).toMatchObject({ timeOrigin: 12_345, total: 1_026, dropped: 2 });
    const events = state?.events as Array<Record<string, unknown>>;
    expect(events).toHaveLength(1_024);
    expect(events[0]).toEqual({
      code: 'KeyA',
      type: 'keydown',
      timeStamp: 100,
      observedAtMs: 20,
      repeat: true,
      trusted: false,
      pointerLocked: true,
      visibility: 'visible',
    });
    expect(events.at(-1)).toMatchObject({ code: 'Space', type: 'keyup', trusted: false });
    expect(window.listenerCount('keydown')).toBe(1);
    expect(window.listenerCount('keyup')).toBe(1);

    await stopClassicKeyboardTiming(run.page, run.info);
    expect(window.listenerCount('keydown')).toBe(0);
    expect(window.listenerCount('keyup')).toBe(0);
    expect(window.removeEventListener).toHaveBeenCalledTimes(2);
    expect(window.__seedlandsClassicKeyboardTimingV1).toBeUndefined();
    const [name, options] = run.attach.mock.calls[0]!;
    expect(name).toBe('classic-keyboard-timing');
    const attachment = JSON.parse(String(options.body));
    expect(attachment).toMatchObject({
      schemaVersion: 1,
      runId: 'keyboard-timing-124',
      sourceSha: 'source-sha-124',
      diagnosticOnly: true,
      eligible: false,
      status: 'COMPLETE',
      observation: { timeOrigin: 12_345, total: 1_026, dropped: 2 },
    });
    expect(attachment.observation.events).toHaveLength(1_024);
    events[0]!.code = 'mutated-after-stop';
    expect(JSON.parse(String(options.body)).observation.events[0].code).toBe('KeyA');
    expect(run.attach).toHaveBeenCalledTimes(1);
    window.dispatch('keydown', { code: 'KeyW', timeStamp: 999, repeat: false, isTrusted: false });
    await stopClassicKeyboardTiming(run.page, run.info);
    expect(run.attach).toHaveBeenCalledTimes(1);
  });

  it('captures each new document time origin independently and reports stop-before-init or closed-page metadata', async () => {
    const run = fixture();
    await startClassicKeyboardTiming(run.page, run.info, false, enabledEnv);
    const oldWindow = run.runDocumentScript({ origin: 111, visibility: 'hidden', pointerLocked: false }).window;
    oldWindow.dispatch('keydown', { code: 'KeyW', timeStamp: 4, repeat: false, isTrusted: false });
    expect(oldWindow.__seedlandsClassicKeyboardTimingV1?.events).toMatchObject([
      { pointerLocked: false, visibility: 'hidden', trusted: false },
    ]);
    const current = run.runDocumentScript({ origin: 222, visibility: 'visible', pointerLocked: true });
    current.window.dispatch('keyup', { code: 'KeyW', timeStamp: 8, repeat: false, isTrusted: false });
    const currentState = current.window.__seedlandsClassicKeyboardTimingV1;
    expect(currentState).toMatchObject({ timeOrigin: 222, total: 1, dropped: 0 });
    expect(currentState?.events).toEqual([
      {
        code: 'KeyW',
        type: 'keyup',
        timeStamp: 8,
        observedAtMs: 0,
        repeat: false,
        trusted: false,
        pointerLocked: true,
        visibility: 'visible',
      },
    ]);
    await stopClassicKeyboardTiming(run.page, run.info);
    expect(JSON.parse(String(run.attach.mock.calls[0]![1].body))).toMatchObject({
      status: 'COMPLETE',
      observation: { timeOrigin: 222, total: 1, dropped: 0 },
    });

    const notStarted = fixture();
    await startClassicKeyboardTiming(notStarted.page, notStarted.info, false, enabledEnv);
    vi.stubGlobal('window', new FakeWindow());
    await stopClassicKeyboardTiming(notStarted.page, notStarted.info);
    expect(JSON.parse(String(notStarted.attach.mock.calls[0]![1].body))).toMatchObject({
      status: 'NOT_STARTED',
      observation: null,
    });

    const closed = fixture();
    await startClassicKeyboardTiming(closed.page, closed.info, false, enabledEnv);
    closed.close();
    await stopClassicKeyboardTiming(closed.page, closed.info);
    expect(JSON.parse(String(closed.attach.mock.calls[0]![1].body))).toMatchObject({
      status: 'PAGE_CLOSED',
      observation: null,
    });
  });

  it('does not replace a timing property already owned by a document', async () => {
    const run = fixture();
    await startClassicKeyboardTiming(run.page, run.info, false, enabledEnv);
    const existingState = { owner: 'existing' };
    expect(() => run.runDocumentScript({ existingState })).toThrow(/already owns keyboard timing/i);
    const window = (globalThis as { window: FakeWindow }).window;
    expect(window.__seedlandsClassicKeyboardTimingV1).toBe(existingState);
    run.close();
    await stopClassicKeyboardTiming(run.page, run.info);
    expect(JSON.parse(String(run.attach.mock.calls[0]![1].body))).toMatchObject({
      status: 'PAGE_CLOSED',
      observation: null,
    });
  });
});
