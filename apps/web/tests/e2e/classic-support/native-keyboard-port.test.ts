import { afterEach, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { test as browserTest, type Page } from '@playwright/test';
import { nativeMovementPage } from './native-keyboard-port';
import { sendNativeMovementPulse } from './native-movement-pulse';

const capture = vi.hoisted(() => ({ attach: vi.fn(async () => {}) }));

vi.mock('@playwright/test', () => ({
  test: {
    step: vi.fn(async (_name: string, run: (info: { attach: () => Promise<void> }) => Promise<unknown>) =>
      run({ attach: capture.attach }),
    ),
  },
}));

function fixture(delay = 0) {
  const calls: { method: string; params: Record<string, unknown>; at: number }[] = [];
  const session = {
    send: vi.fn(
      async (method: string, params: Record<string, unknown>): Promise<Record<string, unknown> | undefined> => {
        calls.push({ method, params, at: Date.now() });
        if (params.type === 'keyDown') await new Promise<void>((resolve) => setTimeout(resolve, delay));
        return undefined;
      },
    ),
  };
  const newCDPSession = vi.fn(async () => session);
  const page = { context: () => ({ newCDPSession }) } as unknown as Page;
  return { page, newCDPSession, session, calls };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it('reuses one public CDP session per page, including concurrent acquisition', async () => {
  const a = fixture(),
    b = fixture();
  const [first, second] = await Promise.all([nativeMovementPage(a.page), nativeMovementPage(a.page)]);
  expect(first).toBe(second);
  expect(await nativeMovementPage(a.page)).toBe(first);
  expect(a.newCDPSession).toHaveBeenCalledExactlyOnceWith(a.page);
  expect(await nativeMovementPage(b.page)).not.toBe(first);
});

for (const [code, key, windowsVirtualKeyCode] of [
  ['KeyW', 'w', 87],
  ['KeyS', 's', 83],
  ['Space', ' ', 32],
] as const)
  it(`sends the installed Chromium native protocol for ${code}`, async () => {
    const f = fixture(),
      port = await nativeMovementPage(f.page);
    await port.keyboard.down(code);
    await port.keyboard.up(code);
    expect(browserTest.step).toHaveBeenNthCalledWith(1, `Native route keydown ${code}`, expect.any(Function));
    expect(browserTest.step).toHaveBeenNthCalledWith(2, `Native route keyup ${code}`, expect.any(Function));
    expect(f.calls.map(({ method, params }) => ({ method, params }))).toEqual([
      {
        method: 'Input.dispatchKeyEvent',
        params: {
          type: 'keyDown',
          modifiers: 0,
          windowsVirtualKeyCode,
          code,
          commands: [],
          key,
          text: key,
          unmodifiedText: key,
          autoRepeat: false,
          location: 0,
          isKeypad: false,
        },
      },
      {
        method: 'Input.dispatchKeyEvent',
        params: { type: 'keyUp', modifiers: 0, key, windowsVirtualKeyCode, code, location: 0 },
      },
    ]);
  });

it('rejects unsupported keys before native dispatch', async () => {
  const f = fixture(),
    port = await nativeMovementPage(f.page);
  await expect(port.keyboard.down('KeyE')).rejects.toThrow('Unsupported native route key');
  await expect(port.keyboard.up('ShiftLeft')).rejects.toThrow('Unsupported native route key');
  expect(f.session.send).not.toHaveBeenCalled();
});

it('preserves release requests at 300ms while both native down ACKs are pending', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const f = fixture(1000),
    port = await nativeMovementPage(f.page);
  const pulse = sendNativeMovementPulse(port, 'KeyW', 300, true);
  try {
    await vi.advanceTimersByTimeAsync(300);
    expect(f.calls.filter((x) => x.params.type === 'keyUp').map((x) => ({ code: x.params.code, at: x.at }))).toEqual([
      { code: 'KeyW', at: 300 },
      { code: 'Space', at: 300 },
    ]);
  } finally {
    await vi.runAllTimersAsync();
    await pulse;
  }
});

it('does not cache a rejected session acquisition', async () => {
  const f = fixture();
  f.newCDPSession.mockRejectedValueOnce(new Error('session unavailable'));
  await expect(nativeMovementPage(f.page)).rejects.toThrow('session unavailable');
  await expect(nativeMovementPage(f.page)).resolves.toHaveProperty('keyboard');
  expect(f.newCDPSession).toHaveBeenCalledTimes(2);
});

it('reads the actual route snapshot by value through the same public session', async () => {
  const f = fixture(),
    port = await nativeMovementPage(f.page);
  const observed = { player: [1, 32.6, 0], authority: { physicsTick: 18, acknowledgedInputSequence: 7 } };
  f.session.send.mockResolvedValueOnce({ result: { type: 'object', value: observed } });
  expect(await port.snapshot()).toEqual(observed);
  expect(f.session.send).toHaveBeenCalledWith('Runtime.evaluate', expect.objectContaining({ returnByValue: true }));
  expect(f.newCDPSession).toHaveBeenCalledTimes(1);
});

it('rejects an observation without a by-value result', async () => {
  const f = fixture(),
    port = await nativeMovementPage(f.page);
  f.session.send.mockResolvedValueOnce({ result: { type: 'object', objectId: 'remote-only' } });
  await expect(port.snapshot()).rejects.toThrow('did not return by value');
});

it('keeps benchmark reads free of physics projection and route diagnostic attachments', async () => {
  vi.stubEnv('SEEDLANDS_CLASSIC_BENCHMARK', '1');
  const f = fixture(),
    port = await nativeMovementPage(f.page);
  f.session.send.mockResolvedValueOnce({ result: { type: 'object', value: null } });
  await expect(port.snapshot()).resolves.toBeNull();
  expect(f.session.send).toHaveBeenCalledWith(
    'Runtime.evaluate',
    expect.objectContaining({
      expression: expect.stringMatching(/\(false\)\s*$/),
    }),
  );
  expect(capture.attach).not.toHaveBeenCalled();
});

it('preserves a missing browser harness as a null snapshot', async () => {
  const f = fixture(),
    port = await nativeMovementPage(f.page);
  f.session.send.mockResolvedValueOnce({ result: { type: 'object', subtype: 'null', value: null } });
  expect(await port.snapshot()).toBeNull();
});

it('propagates browser observation exceptions rather than inventing a snapshot', async () => {
  const f = fixture(),
    port = await nativeMovementPage(f.page);
  f.session.send.mockResolvedValueOnce({
    result: { type: 'undefined' },
    exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: harness unavailable' } },
  });
  await expect(port.snapshot()).rejects.toThrow('harness unavailable');
});

it.each([0, 11, null])('preserves the actual by-value voxel result %s', async (value) => {
  const f = fixture(),
    port = await nativeMovementPage(f.page);
  f.session.send.mockResolvedValueOnce({ result: { value } });
  expect(await port.voxelAt([75, 31, 0])).toBe(value);
  expect(f.session.send).toHaveBeenCalledWith(
    'Runtime.evaluate',
    expect.objectContaining({ returnByValue: true, expression: expect.stringMatching(/\(\[75,31,0\]\)$/) }),
  );
  expect(f.newCDPSession).toHaveBeenCalledTimes(1);
});

it('executes the public voxel reader against the supplied browser target', async () => {
  const getVoxelAt = vi.fn(() => 11);
  const f = fixture(),
    port = await nativeMovementPage(f.page);
  f.session.send.mockImplementationOnce(async (_method, params) => ({
    result: { value: runInNewContext(String(params.expression), { window: { __seedlandsHarness: { getVoxelAt } } }) },
  }));
  expect(await port.voxelAt([75, 31, 0])).toBe(11);
  expect(getVoxelAt).toHaveBeenCalledExactlyOnceWith(75, 31, 0);
});

it('propagates voxel evaluation errors without a success substitute', async () => {
  const f = fixture(),
    port = await nativeMovementPage(f.page);
  f.session.send.mockResolvedValueOnce({ result: {}, exceptionDetails: { text: 'voxel read failed' } });
  await expect(port.voxelAt([75, 31, 0])).rejects.toThrow('voxel read failed');
});

it('rejects a voxel result that was not returned by value', async () => {
  const f = fixture(),
    port = await nativeMovementPage(f.page);
  f.session.send.mockResolvedValueOnce({ result: { objectId: 'remote-only' } });
  await expect(port.voxelAt([75, 31, 0])).rejects.toThrow('did not return by value');
});

it('rejects nonfinite voxel coordinates before sending a protocol read', async () => {
  const f = fixture(),
    port = await nativeMovementPage(f.page);
  await expect(port.voxelAt([NaN, 31, 0])).rejects.toThrow('finite');
  expect(f.session.send).not.toHaveBeenCalled();
});

it('keeps benchmark voxel reads free of diagnostic attachments', async () => {
  vi.stubEnv('SEEDLANDS_CLASSIC_BENCHMARK', '1');
  const f = fixture(),
    port = await nativeMovementPage(f.page);
  f.session.send.mockResolvedValueOnce({ result: { value: 11 } });
  expect(await port.voxelAt([75, 31, 0])).toBe(11);
  expect(capture.attach).not.toHaveBeenCalled();
});
