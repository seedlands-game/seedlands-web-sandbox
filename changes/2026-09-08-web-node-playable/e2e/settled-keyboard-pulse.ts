import { Buffer } from 'node:buffer';
import type { WebSocket as PlaywrightWebSocket } from '@playwright/test';
import { decodeC0Envelope } from '../../../packages/game-core/src/server/protocol/network-c0-codec';
import type { SequenceDecision } from '../../../packages/game-core/src/runtime/session-protocol';

const MAX_CONTROL_FRAME_BYTES = 16 * 1024;
const ZERO_VELOCITY_EPSILON = 1e-6;
const MOVEMENT_DIRECTION_DOT_MINIMUM = 0.999;
const allowedDecisions = new Set<SequenceDecision>([
  'accepted',
  'invalid',
  'duplicate',
  'out-of-order',
  'late',
  'target-out-of-order',
  'too-far-ahead',
  'capacity',
  'wrong-epoch',
  'wrong-stream',
]);
const utf8 = {
  encode: (value: string) => new TextEncoder().encode(value),
  decodeFatal: (value: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(value),
};

type SentInput = Readonly<{ sequence: number; neutral: boolean; matchesMovement: boolean }>;
type Correction = Readonly<{
  physicsTick: number;
  acknowledgedInputSequence: number;
  position: readonly [number, number, number];
  velocity: readonly [number, number, number];
}>;
type KeyboardPort = Readonly<{ down(key: string): Promise<void>; up(key: string): Promise<void> }>;
type ClientEvidence = Readonly<{ physicsTick: number; authoritativePlayer: readonly [number, number, number] }>;

export type SettledKeyboardPulse = Readonly<{
  movementSequence: number;
  neutralSequence: number;
  correction: Correction;
}>;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const vector = (value: unknown): readonly [number, number, number] | null => {
  if (!value || typeof value !== 'object') return null;
  const { x, y, z } = value as Record<string, unknown>;
  return finite(x) && finite(y) && finite(z) ? [x, y, z] : null;
};

class InputSettlementObserver {
  private readonly sent = new Map<number, SentInput>();
  private readonly decisions = new Map<number, SequenceDecision>();
  private correction: Correction | null = null;
  private closed = false;
  private readonly waiters = new Set<() => void>();

  private readonly onSent = ({ payload }: { payload: string | Buffer }) => this.acceptFrame('sent', payload);
  private readonly onReceived = ({ payload }: { payload: string | Buffer }) => this.acceptFrame('received', payload);
  private readonly onClose = () => {
    this.closed = true;
    this.notify();
    this.dispose();
  };
  private readonly onAbort = () => this.onClose();

  constructor(
    private readonly socket: PlaywrightWebSocket,
    private readonly expectedMovement: Readonly<{ moveX: number; moveZ: number }>,
    private readonly signal?: AbortSignal,
  ) {
    socket.on('framesent', this.onSent);
    socket.on('framereceived', this.onReceived);
    socket.on('close', this.onClose);
    signal?.addEventListener('abort', this.onAbort, { once: true });
    if (signal?.aborted) this.onAbort();
  }

  async movementAccepted(deadline: number): Promise<number> {
    return this.waitFor(() => {
      for (const input of this.sent.values())
        if (input.matchesMovement && this.decisions.get(input.sequence) === 'accepted') return input.sequence;
      return null;
    }, deadline);
  }

  async neutralApplied(afterSequence: number, deadline: number): Promise<SettledKeyboardPulse> {
    return this.waitFor(() => {
      for (const input of this.sent.values()) {
        if (input.sequence <= afterSequence || !input.neutral || this.decisions.get(input.sequence) !== 'accepted')
          continue;
        const correction = this.correction;
        if (!correction || correction.acknowledgedInputSequence < input.sequence) continue;
        if (Math.hypot(correction.velocity[0], correction.velocity[2]) > ZERO_VELOCITY_EPSILON) continue;
        return { movementSequence: afterSequence, neutralSequence: input.sequence, correction };
      }
      return null;
    }, deadline);
  }

  summary() {
    const sent = [...this.sent.values()].slice(-4);
    return {
      sent,
      decisions: sent.map(({ sequence }) => ({ sequence, decision: this.decisions.get(sequence) ?? null })),
      correction: this.correction,
    };
  }

  dispose(): void {
    this.socket.off('framesent', this.onSent);
    this.socket.off('framereceived', this.onReceived);
    this.socket.off('close', this.onClose);
    this.signal?.removeEventListener('abort', this.onAbort);
  }

  private acceptFrame(direction: 'sent' | 'received', payload: string | Buffer): void {
    if (typeof payload === 'string' || payload.byteLength > MAX_CONTROL_FRAME_BYTES) return;
    let decoded: ReturnType<typeof decodeC0Envelope>;
    try {
      decoded = decodeC0Envelope(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength), utf8);
    } catch {
      return;
    }
    const message = decoded.message as Record<string, unknown>;
    if (direction === 'sent' && decoded.messageClass === 'input-state') this.acceptInput(message);
    else if (direction === 'received' && decoded.messageClass === 'input-decision') this.acceptDecision(message);
    else if (direction === 'received' && decoded.messageClass === 'authority-state')
      this.acceptCorrection(message.correction);
  }

  private acceptInput(message: Record<string, unknown>): void {
    if (!integer(message.inputSequence) || !finite(message.moveX) || !finite(message.moveZ)) return;
    const neutral =
      message.moveX === 0 && message.moveZ === 0 && message.verticalIntent === 0 && message.jumpHeld === false;
    const movementLength = Math.hypot(message.moveX, message.moveZ);
    const matchesMovement =
      !neutral &&
      movementLength > 0 &&
      (message.moveX * this.expectedMovement.moveX + message.moveZ * this.expectedMovement.moveZ) / movementLength >=
        MOVEMENT_DIRECTION_DOT_MINIMUM;
    this.sent.set(message.inputSequence, { sequence: message.inputSequence, neutral, matchesMovement });
    while (this.sent.size > 8) this.sent.delete(this.sent.keys().next().value!);
    this.notify();
  }

  private acceptDecision(message: Record<string, unknown>): void {
    if (!integer(message.inputSequence) || !allowedDecisions.has(message.decision as SequenceDecision)) return;
    this.decisions.set(message.inputSequence, message.decision as SequenceDecision);
    while (this.decisions.size > 8) this.decisions.delete(this.decisions.keys().next().value!);
    this.notify();
  }

  private acceptCorrection(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const correction = value as Record<string, unknown>;
    const player = correction.player as Record<string, unknown> | undefined;
    const position = vector(player?.position);
    const velocity = vector(player?.velocity);
    if (!integer(correction.physicsTick) || !integer(correction.acknowledgedInputSequence) || !position || !velocity)
      return;
    this.correction = {
      physicsTick: correction.physicsTick,
      acknowledgedInputSequence: correction.acknowledgedInputSequence,
      position,
      velocity,
    };
    this.notify();
  }

  private waitFor<T>(read: () => T | null, deadline: number): Promise<T> {
    const immediate = read();
    if (immediate !== null) return Promise.resolve(immediate);
    return new Promise<T>((resolve, reject) => {
      const check = () => {
        if (this.closed || this.socket.isClosed()) return settle(null, new Error('socket-closed'));
        const value = read();
        if (value !== null) settle(value, null);
      };
      const settle = (value: T | null, error: Error | null) => {
        clearTimeout(timer);
        this.waiters.delete(check);
        if (error) reject(error);
        else resolve(value!);
      };
      const timer = setTimeout(() => settle(null, new Error('settlement-timeout')), Math.max(0, deadline - Date.now()));
      this.waiters.add(check);
      check();
    });
  }

  private notify(): void {
    for (const waiter of [...this.waiters]) waiter();
  }
}

const samePosition = (left: readonly number[], right: readonly number[]) =>
  left.length === 3 && right.length === 3 && left.every((value, index) => Math.abs(value - right[index]!) <= 1e-6);

export async function driveSettledKeyboardPulse(
  options: Readonly<{
    socket: PlaywrightWebSocket;
    expectedUrl: string;
    keyboard: KeyboardPort;
    keys: readonly string[];
    expectedMovement: Readonly<{ moveX: number; moveZ: number }>;
    readEvidence(): Promise<ClientEvidence>;
    minimumHoldMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  }>,
): Promise<SettledKeyboardPulse> {
  if (options.socket.url() !== options.expectedUrl) throw new Error('playable-socket-mismatch');
  if (!finite(options.expectedMovement.moveX) || !finite(options.expectedMovement.moveZ))
    throw new Error('playable-keyboard-movement-invalid');
  const movementLength = Math.hypot(options.expectedMovement.moveX, options.expectedMovement.moveZ);
  if (movementLength <= 0) throw new Error('playable-keyboard-movement-missing');
  const expectedMovement = {
    moveX: options.expectedMovement.moveX / movementLength,
    moveZ: options.expectedMovement.moveZ / movementLength,
  };
  const observer = new InputSettlementObserver(options.socket, expectedMovement, options.signal);
  const deadline = Date.now() + (options.timeoutMs ?? 2_000);
  const pressed: string[] = [];
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let phase = 'keydown';
  try {
    for (const key of options.keys) {
      await options.keyboard.down(key);
      pressed.push(key);
    }
    phase = 'movement-accepted';
    const hold = new Promise<void>((resolve) => {
      holdTimer = setTimeout(resolve, options.minimumHoldMs ?? 35);
    });
    const movementSequence = await observer.movementAccepted(deadline);
    await hold;
    phase = 'keyup';
    while (pressed.length) {
      await options.keyboard.up(pressed.at(-1)!);
      pressed.pop();
    }
    phase = 'neutral-applied';
    const settled = await observer.neutralApplied(movementSequence, deadline);
    phase = 'client-visible';
    while (Date.now() <= deadline) {
      const evidence = await options.readEvidence();
      // The journey enters alignment only after onGround=true; exact XYZ binds readback to this correction.
      if (
        evidence.physicsTick >= settled.correction.physicsTick &&
        samePosition(evidence.authoritativePlayer, settled.correction.position)
      )
        return settled;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('client-evidence-timeout');
  } catch {
    throw new Error(`keyboard-pulse-unsettled:${JSON.stringify({ phase, ...observer.summary() })}`);
  } finally {
    if (holdTimer) clearTimeout(holdTimer);
    for (const key of pressed.reverse()) await options.keyboard.up(key).catch(() => undefined);
    observer.dispose();
  }
}
