import { describe, expect, it } from 'vitest';
import {
  validateControllerHostMessage,
  validateControllerUrl,
} from '../../apps/web/src/client/character/controller-bridge-validation';
const binding = { sessionId: 's', worldId: 'w', epoch: 'e', entityId: 'n', incarnation: 'i', policyRevision: 1 };
describe('character controller boundary', () => {
  it('accepts only loopback WebSocket and rejects credential-bearing URLs', () => {
    expect(validateControllerUrl('ws://127.0.0.1:4318')).toBe('ws://127.0.0.1:4318/');
    for (const url of [
      'ws://remote.example:4318',
      'http://localhost:4318',
      'ws://user:pass@localhost:4318',
      'ws://localhost:4318/?token=secret',
    ])
      expect(() => validateControllerUrl(url)).toThrow();
  });
  it('rejects stale binding, forged methods, invalid goal and excessive speech before execution', () => {
    const message = {
      kind: 'intent',
      protocolVersion: 1,
      binding,
      sequence: 1,
      requestId: 'r',
      observedRevision: 1,
      observedCursor: 0,
      intent: { goal: { kind: 'forage' }, say: '我去找些吃的。' },
    };
    expect(validateControllerHostMessage(message, binding, 0)?.kind).toBe('intent');
    expect(validateControllerHostMessage(message, binding, 1)).toBeNull();
    expect(
      validateControllerHostMessage({ ...message, binding: { ...binding, entityId: 'other' } }, binding, 0),
    ).toBeNull();
    expect(
      validateControllerHostMessage({ ...message, intent: { goal: { kind: 'teleport' } } }, binding, 0),
    ).toBeNull();
    expect(
      validateControllerHostMessage(
        { ...message, intent: { goal: { kind: 'forage' }, say: 'a'.repeat(281) } },
        binding,
        0,
      ),
    ).toBeNull();
    expect(validateControllerHostMessage({ ...message, kind: 'eval', source: 'world.clear()' }, binding, 0)).toBeNull();
  });
});

import { afterEach, vi } from 'vitest';
import {
  CharacterControllerBridge,
  type CharacterControllerPort,
} from '../../apps/web/src/client/character/controller-bridge';
import type { CharacterObservation } from '@seedlands/game-core/runtime/character-control-protocol';
const frontier = {
  worldId: 'w',
  epoch: 'e',
  worldRevision: 1,
  commitSequence: 1,
  physicsTick: 0,
  fluidWorkSequence: 0,
  logicObservationSequence: 0,
};
class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: Record<string, unknown>[] = [];
  close = vi.fn();
  send(value: string) {
    this.sent.push(JSON.parse(value));
  }
  receive(value: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ protocolVersion: 1, binding, ...value }) });
  }
}
const observation = { cursor: 3, events: [] } as unknown as CharacterObservation;
function setup() {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  const socket = new FakeSocket();
  const port: CharacterControllerPort = {
    binding,
    dispose: vi.fn(),
    observe: vi.fn(async () => ({ ok: true as const, frontier, data: { kind: 'observation' as const, observation } })),
    intent: vi.fn(async () => ({
      ok: false as const,
      error: { code: 'STALE_REVISION', kind: 'conflict' as const, message: 'stale' },
    })),
    memory: vi.fn(async () => ({
      ok: false as const,
      error: { code: 'STALE_MEMORY', kind: 'conflict' as const, message: 'stale' },
    })),
  };
  let paused = false;
  const onState = vi.fn();
  const bridge = new CharacterControllerBridge({
    paused: () => paused,
    onState,
    socket: () => socket as unknown as WebSocket,
  });
  bridge.connect('ws://localhost:8787', 'local-pair-code', port);
  socket.onopen?.();
  return { socket, port, bridge, onState, pause: (value: boolean) => (paused = value) };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('character bridge lifecycle', () => {
  it.each([false, true])('publishes ready only after the initial history is sent (paused=%s)', async (paused) => {
    const { socket, port, bridge, onState, pause } = setup();
    pause(paused);
    bridge.setPaused(paused);
    let release!: (result: Awaited<ReturnType<CharacterControllerPort['observe']>>) => void;
    vi.mocked(port.observe).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    socket.receive({ kind: 'ready', sequence: 0, fallbackSeconds: 180, modelAvailability: 'available' });
    await vi.advanceTimersByTimeAsync(0);
    expect(port.observe).toHaveBeenCalledOnce();
    expect(onState.mock.calls.at(-1)?.[0]).toMatchObject({ phase: 'connecting' });
    release({ ok: true, frontier, data: { kind: 'observation', observation } });
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.sent.at(-1)).toMatchObject({ kind: 'observe', observation });
    expect(socket.sent.some((message) => message.kind === 'control' && message.command === 'pause')).toBe(paused);
    expect(onState.mock.calls.at(-1)?.[0]).toMatchObject({ phase: 'ready' });
    bridge.disconnect();
  });
  it('waits for binding ready, returns Authority rejection, and blocks delayed work after disconnect', async () => {
    const { socket, port, bridge } = setup();
    expect(socket.sent.map((message) => message.kind)).toEqual(['hello']);
    socket.receive({ kind: 'ready', sequence: 0, fallbackSeconds: 180, modelAvailability: 'available' });
    await vi.advanceTimersByTimeAsync(0);
    expect(port.observe).toHaveBeenCalledOnce();
    socket.receive({
      kind: 'intent',
      sequence: 1,
      requestId: 'r',
      observedRevision: 1,
      observedCursor: 3,
      intent: { goal: { kind: 'forage' } },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(port.intent).toHaveBeenCalledWith('r', 1, 3, { kind: 'forage' }, undefined);
    expect(socket.sent.at(-1)).toMatchObject({
      kind: 'receipt',
      receipt: { requestId: 'r', status: 'rejected', reason: 'STALE_REVISION' },
    });
    const late = socket.onmessage;
    bridge.disconnect();
    late?.({
      data: JSON.stringify({
        protocolVersion: 1,
        binding,
        sequence: 2,
        kind: 'intent',
        requestId: 'late',
        observedRevision: 1,
        observedCursor: 3,
        intent: { goal: { kind: 'idle' } },
      }),
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(port.intent).toHaveBeenCalledOnce();
    expect(port.observe).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();
    expect(port.dispose).toHaveBeenCalledOnce();
  });
  it('pauses observations with the world and resumes without a second world or binding', async () => {
    const { socket, port, bridge, pause } = setup();
    pause(true);
    socket.receive({ kind: 'ready', sequence: 0, fallbackSeconds: 180, modelAvailability: 'available' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(port.observe).toHaveBeenCalledOnce();
    expect(socket.sent).toContainEqual(expect.objectContaining({ kind: 'control', command: 'pause' }));
    pause(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(port.observe).toHaveBeenCalledTimes(2);
    expect(socket.sent).toContainEqual(expect.objectContaining({ kind: 'control', command: 'resume' }));
    bridge.disconnect();
  });
  it('sends pause immediately and rejects an in-flight model intent before Authority writes', async () => {
    const { socket, port, bridge, pause } = setup();
    socket.receive({ kind: 'ready', sequence: 0, fallbackSeconds: 180, modelAvailability: 'available' });
    await vi.advanceTimersByTimeAsync(0);
    socket.receive({ kind: 'status', sequence: 1, state: 'thinking' });
    await vi.advanceTimersByTimeAsync(0);

    pause(true);
    bridge.setPaused(true);
    expect(socket.sent.at(-1)).toMatchObject({ kind: 'control', command: 'pause' });
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    socket.receive({
      kind: 'intent',
      sequence: 2,
      requestId: 'late-while-paused',
      observedRevision: 1,
      observedCursor: 3,
      intent: {
        goal: { kind: 'follow', target: { kind: 'entity', ref: 'player', revision: 1 } },
        say: '我来了。',
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(port.intent).not.toHaveBeenCalled();
    expect(socket.sent.at(-1)).toMatchObject({
      kind: 'receipt',
      receipt: { requestId: 'late-while-paused', status: 'rejected', reason: 'WORLD_PAUSED' },
    });

    socket.receive({
      kind: 'memory',
      sequence: 3,
      requestId: 'memory-while-paused',
      expectedMemoryRevision: 0,
      throughCursor: 3,
      summary: '已确认的公开经历',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(port.memory).toHaveBeenCalledWith(0, 3, '已确认的公开经历');
    expect(socket.sent.at(-1)).toMatchObject({
      kind: 'receipt',
      receipt: { requestId: 'memory-while-paused', status: 'rejected', reason: 'STALE_MEMORY' },
    });

    pause(false);
    bridge.setPaused(false);
    expect(socket.sent.at(-1)).toMatchObject({ kind: 'control', command: 'resume' });
    await vi.advanceTimersByTimeAsync(500);
    expect(port.observe).toHaveBeenCalledTimes(2);
    bridge.disconnect();
  });
});
