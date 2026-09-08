import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { AuthorityReady } from '../../packages/game-core/src/compute/authority-worker-protocol';
import { encodeC0Envelope } from '../../packages/game-core/src/server/protocol/network-c0-codec';
import type { PublicSessionRef } from '../../packages/game-core/src/server/protocol/network-message-semantics';
import { createSession } from '../../apps/node-server/src/node/server/node-playable-network-session';
import type { NodeAuthorityLane } from '../../apps/node-server/src/node/runtime/node-authority-lane';

class FakeSocket extends EventEmitter {
  readonly readyState = 1;
  readonly bufferedAmount = 0;
  closed: Readonly<{ code: number; reason: string }> | null = null;
  sent = 0;

  send(_data: Uint8Array, _options: unknown, callback: (error?: Error) => void): void {
    this.sent += 1;
    callback();
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }
}

const utf8 = {
  encode: (value: string) => new TextEncoder().encode(value),
  decodeFatal: (value: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(value),
};
const ref: PublicSessionRef = {
  protocolVersion: 1,
  sessionEpoch: 'checkpoint-session',
  worldId: 'default',
  playerId: 'player-1',
};
const body = {
  id: 'player-1',
  type: 'player' as const,
  body: { position: { x: 0.5, y: 40, z: 0.5 }, velocity: { x: 0, y: 0, z: 0 } },
  grounded: true,
  contacts: [],
};
const ready = {
  playerId: 'player-1',
  playerBodyPosition: [0.5, 40, 0.5],
  isNew: true,
  seed: 1,
  seedText: 'checkpoint-pending',
  generatorVersion: 1,
  worldTime: 0,
  frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
  snapshot: {
    kind: 'snapshot',
    protocolVersion: 1,
    epoch: 'node-checkpoint',
    physicsTick: 1,
    commitSequence: 0,
    worldMutationCount: 0,
    acknowledgedInputSequence: -1,
    inputResyncRequired: false,
    activeTimeMs: 0,
    integratedPhysicsTimeMs: 0,
    physicsDebtMs: 0,
    player: body,
    entities: [body],
    chunkRevisions: {},
    worldRevision: 0,
    worldTime: 0,
    paused: false,
  },
  gameplay: undefined,
} as unknown as AuthorityReady;

const checkpoint = (requestId: number) =>
  encodeC0Envelope(
    {
      messageClass: 'checkpoint-request',
      message: { kind: 'checkpoint-request', ref, requestId },
      blocks: [],
    },
    utf8,
  );

const interest = (requestId: number) =>
  encodeC0Envelope(
    {
      messageClass: 'interest-update',
      message: { kind: 'interest-update', ref, requestId, keys: ['0,1,0'] },
      blocks: [],
    },
    utf8,
  );

describe('playable session asynchronous request budget', () => {
  it('closes a client that queues another checkpoint while the first durable write is blocked', async () => {
    const socket = new FakeSocket();
    const requestCheckpoint = vi.fn(() => new Promise<never>(() => {}));
    const authority = {
      requestCheckpoint,
      latestSnapshot: () => ready.snapshot,
      subscribePublication: () => () => undefined,
      clearInput: async () => undefined,
      cancelBaselineCapture: async () => ({ status: 'cancelled' }),
    } as unknown as NodeAuthorityLane;
    createSession(
      socket as never,
      authority,
      ref,
      ready,
      'node-checkpoint',
      () => undefined,
      () => 1,
      () => 1,
      () => 1,
    );

    socket.emit('message', checkpoint(1), true);
    await vi.waitFor(() => expect(requestCheckpoint).toHaveBeenCalledTimes(1));
    socket.emit('message', checkpoint(2), true);
    await vi.waitFor(() => expect(socket.closed).toMatchObject({ code: 4003 }));
    expect(socket.closed?.reason).toContain('checkpoint request is already pending');
    expect(requestCheckpoint).toHaveBeenCalledTimes(1);
  });

  it('detaches session drain from a blocked capture, cancels it, and ignores a late completion', async () => {
    const socket = new FakeSocket();
    let finishCapture!: (capture: unknown) => void;
    const captureBaseline = vi.fn(
      () =>
        new Promise((resolve) => {
          finishCapture = resolve;
        }),
    );
    const cancelBaselineCapture = vi.fn(async () => ({ status: 'cancelled' }));
    const authority = {
      captureBaseline,
      cancelBaselineCapture,
      latestSnapshot: () => ready.snapshot,
      subscribePublication: () => () => undefined,
      clearInput: async () => undefined,
    } as unknown as NodeAuthorityLane;
    const session = createSession(
      socket as never,
      authority,
      ref,
      ready,
      'node-checkpoint',
      () => undefined,
      () => 1,
      () => 1,
      () => 17,
    );

    socket.emit('message', interest(1), true);
    await vi.waitFor(() => expect(captureBaseline).toHaveBeenCalledTimes(1));
    socket.emit('close');
    await expect(session.whenDrained()).resolves.toBeUndefined();
    expect(cancelBaselineCapture).toHaveBeenCalledWith(17);

    finishCapture({ status: 'unavailable' });
    await Promise.resolve();
    expect(socket.sent).toBe(0);
  });
});
