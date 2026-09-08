import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket as PlaywrightWebSocket } from '@playwright/test';
import { driveSettledKeyboardPulse } from '../../changes/2026-09-08-web-node-playable/e2e/settled-keyboard-pulse';
import { encodeC0Envelope } from '../../packages/game-core/src/server/protocol/network-c0-codec';
import type {
  NetworkMessageClass,
  PublicInboundMessage,
  PublicSessionRef,
} from '../../packages/game-core/src/server/protocol/network-message-semantics';
import type { PlayablePublicOutboundMessage } from '../../packages/game-core/src/server/protocol/network-playable-message-semantics';

const utf8 = {
  encode: (value: string) => new TextEncoder().encode(value),
  decodeFatal: (value: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(value),
};
const ref: PublicSessionRef = {
  protocolVersion: 1,
  sessionEpoch: 'settled-pulse-session',
  worldId: 'default',
  playerId: 'player-1',
};
type FrameEvent = { payload: string | Buffer };
type FrameListener = (event: FrameEvent) => void;
type InputStateMessage = Extract<PublicInboundMessage, { kind: 'input-state' }>;

class FakeFrameSocket {
  private closed = false;
  private readonly listeners = {
    framesent: new Set<FrameListener>(),
    framereceived: new Set<FrameListener>(),
    close: new Set<() => void>(),
  };

  url() {
    return 'ws://127.0.0.1:8787/seedlands';
  }
  isClosed() {
    return this.closed;
  }
  on(event: keyof typeof this.listeners, listener: FrameListener | (() => void)) {
    (this.listeners[event] as Set<FrameListener | (() => void)>).add(listener);
  }
  off(event: keyof typeof this.listeners, listener: FrameListener | (() => void)) {
    (this.listeners[event] as Set<FrameListener | (() => void)>).delete(listener);
  }
  emit(event: 'framesent' | 'framereceived', payload: Buffer) {
    for (const listener of this.listeners[event]) listener({ payload });
  }
  close() {
    this.closed = true;
    for (const listener of this.listeners.close) listener();
  }
  listenerCount() {
    return Object.values(this.listeners).reduce((total, listeners) => total + listeners.size, 0);
  }
}

const frame = (messageClass: NetworkMessageClass, message: PublicInboundMessage | PlayablePublicOutboundMessage) =>
  Buffer.from(encodeC0Envelope({ messageClass, message, blocks: [] }, utf8));

const input = (sequence: number, moveX: number, moveZ: number): InputStateMessage => ({
  kind: 'input-state',
  ref,
  inputSequence: sequence,
  targetPhysicsTick: 100 + sequence,
  expiresAfterPhysicsTick: 130 + sequence,
  moveX,
  moveZ,
  verticalIntent: 0,
  jumpHeld: false,
});
const decision = (sequence: number, accepted = true): PlayablePublicOutboundMessage => ({
  kind: 'input-decision',
  ref,
  inputSequence: sequence,
  decision: accepted ? 'accepted' : 'late',
  requiresResync: !accepted,
});
const authorityState = (
  acknowledgedInputSequence: number,
  velocityX: number,
  position: readonly [number, number, number],
): PlayablePublicOutboundMessage => ({
  kind: 'authority-state',
  ref,
  publicationSequence: 1,
  correction: {
    kind: 'player-correction-reference',
    physicsTick: 44,
    acknowledgedInputSequence,
    player: {
      position: { x: position[0], y: position[1], z: position[2] },
      velocity: { x: velocityX, y: 0, z: 0 },
    },
  },
  commits: [],
});

afterEach(() => {
  vi.useRealTimers();
});

describe('settled keyboard pulse', () => {
  it('holds through slow sampling and waits for accepted neutral application visible to the client', async () => {
    vi.useFakeTimers();
    const socket = new FakeFrameSocket();
    const keyboard = { down: vi.fn(async () => undefined), up: vi.fn(async () => undefined) };
    let evidence: { physicsTick: number; authoritativePlayer: readonly [number, number, number] } = {
      physicsTick: 43,
      authoritativePlayer: [0, 0, 0],
    };
    const pulse = driveSettledKeyboardPulse({
      socket: socket as unknown as PlaywrightWebSocket,
      expectedUrl: socket.url(),
      keyboard,
      keys: ['KeyW'],
      expectedMovement: { moveX: -Math.SQRT1_2, moveZ: -Math.SQRT1_2 },
      readEvidence: async () => evidence,
      timeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(35);
    expect(keyboard.up).not.toHaveBeenCalled();
    socket.emit('framesent', Buffer.alloc(16 * 1024 + 1));
    socket.emit('framesent', frame('input-state', input(9, 1, 0)));
    socket.emit('framereceived', frame('input-decision', decision(9)));
    expect(keyboard.up).not.toHaveBeenCalled();
    socket.emit('framesent', frame('input-state', input(10, -Math.SQRT1_2, -Math.SQRT1_2)));
    socket.emit('framereceived', frame('input-decision', decision(10, false)));
    expect(keyboard.up).not.toHaveBeenCalled();
    socket.emit('framesent', frame('input-state', input(11, -Math.SQRT1_2, -Math.SQRT1_2)));
    socket.emit('framereceived', frame('input-decision', decision(11)));
    await vi.advanceTimersByTimeAsync(0);
    expect(keyboard.up).toHaveBeenCalledWith('KeyW');

    socket.emit('framesent', frame('input-state', input(9, 0, 0)));
    socket.emit('framesent', frame('input-state', input(12, 0, 0)));
    socket.emit('framereceived', frame('input-decision', decision(12)));
    socket.emit('framereceived', frame('authority-state', authorityState(11, 0, [1, 2, 3])));
    let resolved = false;
    void pulse.then(() => (resolved = true));
    await vi.advanceTimersByTimeAsync(20);
    expect(resolved).toBe(false);

    socket.emit('framereceived', frame('authority-state', authorityState(12, 0.25, [1, 2, 3])));
    await vi.advanceTimersByTimeAsync(20);
    expect(resolved).toBe(false);

    socket.emit('framereceived', frame('authority-state', authorityState(12, 0, [1, 2, 3])));
    await vi.advanceTimersByTimeAsync(20);
    expect(resolved).toBe(false);
    evidence = { physicsTick: 44, authoritativePlayer: [1, 2, 3] as const };
    await vi.advanceTimersByTimeAsync(10);
    await expect(pulse).resolves.toMatchObject({ movementSequence: 11, neutralSequence: 12 });
    expect(socket.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases the key and listeners when the playable socket closes', async () => {
    vi.useFakeTimers();
    const socket = new FakeFrameSocket();
    const keyboard = { down: vi.fn(async () => undefined), up: vi.fn(async () => undefined) };
    const pulse = driveSettledKeyboardPulse({
      socket: socket as unknown as PlaywrightWebSocket,
      expectedUrl: socket.url(),
      keyboard,
      keys: ['KeyD'],
      expectedMovement: { moveX: 1, moveZ: 0 },
      readEvidence: async () => ({ physicsTick: 0, authoritativePlayer: [0, 0, 0] }),
      timeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(0);
    socket.close();
    await expect(pulse).rejects.toThrow(/keyboard-pulse-unsettled/);
    expect(keyboard.up).toHaveBeenCalledWith('KeyD');
    expect(socket.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases the key, listeners, and hold timer when settlement times out', async () => {
    vi.useFakeTimers();
    const socket = new FakeFrameSocket();
    const keyboard = { down: vi.fn(async () => undefined), up: vi.fn(async () => undefined) };
    const pulse = driveSettledKeyboardPulse({
      socket: socket as unknown as PlaywrightWebSocket,
      expectedUrl: socket.url(),
      keyboard,
      keys: ['KeyA'],
      expectedMovement: { moveX: -1, moveZ: 0 },
      readEvidence: async () => ({ physicsTick: 0, authoritativePlayer: [0, 0, 0] }),
      timeoutMs: 100,
    });
    const failurePromise = pulse.then<never, Error>(
      () => {
        throw new Error('expected-timeout');
      },
      (error: unknown) => error as Error,
    );
    await vi.advanceTimersByTimeAsync(101);
    const failure = await failurePromise;
    expect(failure.message).toContain('keyboard-pulse-unsettled');
    expect(keyboard.up).toHaveBeenCalledWith('KeyA');
    expect(socket.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up when the page lifecycle aborts the active pulse', async () => {
    vi.useFakeTimers();
    const socket = new FakeFrameSocket();
    const closed = new AbortController();
    const keyboard = { down: vi.fn(async () => undefined), up: vi.fn(async () => undefined) };
    const pulse = driveSettledKeyboardPulse({
      socket: socket as unknown as PlaywrightWebSocket,
      expectedUrl: socket.url(),
      keyboard,
      keys: ['KeyS'],
      expectedMovement: { moveX: 0, moveZ: 1 },
      signal: closed.signal,
      readEvidence: async () => ({ physicsTick: 0, authoritativePlayer: [0, 0, 0] }),
      timeoutMs: 1_000,
    });
    const failurePromise = pulse.then<never, Error>(
      () => {
        throw new Error('expected-abort');
      },
      (error: unknown) => error as Error,
    );
    await vi.advanceTimersByTimeAsync(0);
    closed.abort();
    expect((await failurePromise).message).toContain('keyboard-pulse-unsettled');
    expect(keyboard.up).toHaveBeenCalledWith('KeyS');
    expect(socket.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports only allowlisted state when reading client evidence fails', async () => {
    vi.useFakeTimers();
    const socket = new FakeFrameSocket();
    const keyboard = { down: vi.fn(async () => undefined), up: vi.fn(async () => undefined) };
    const pulse = driveSettledKeyboardPulse({
      socket: socket as unknown as PlaywrightWebSocket,
      expectedUrl: socket.url(),
      keyboard,
      keys: ['KeyW'],
      expectedMovement: { moveX: 0, moveZ: -1 },
      readEvidence: async () => {
        throw new Error('synthetic-sensitive-error');
      },
      timeoutMs: 100,
    });
    const failurePromise = pulse.then<never, Error>(
      () => {
        throw new Error('expected-read-failure');
      },
      (error: unknown) => error as Error,
    );
    await vi.advanceTimersByTimeAsync(0);
    socket.emit('framesent', frame('input-state', input(1, 0, -1)));
    socket.emit('framereceived', frame('input-decision', decision(1)));
    await vi.advanceTimersByTimeAsync(35);
    socket.emit('framesent', frame('input-state', input(2, 0, 0)));
    socket.emit('framereceived', frame('input-decision', decision(2)));
    socket.emit('framereceived', frame('authority-state', authorityState(2, 0, [1, 2, 3])));
    const failure = await failurePromise;
    expect(failure.message).toContain('keyboard-pulse-unsettled');
    expect(failure.message).not.toContain('synthetic-sensitive-error');
    expect(socket.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
