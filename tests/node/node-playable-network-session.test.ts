import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { AuthorityReady } from '../../packages/game-core/src/compute/authority-worker-protocol';
import { encodeC0Envelope } from '../../packages/game-core/src/server/protocol/network-c0-codec';
import type { PublicSessionRef } from '../../packages/game-core/src/server/protocol/network-message-semantics';
import {
  createSession,
  type NodePlayableSessionDiagnosticEvent,
} from '../../apps/node-server/src/node/server/node-playable-network-session';
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

const input = (inputSequence: number, targetPhysicsTick = 20) =>
  encodeC0Envelope(
    {
      messageClass: 'input-state',
      message: {
        kind: 'input-state',
        ref,
        inputSequence,
        targetPhysicsTick,
        expiresAfterPhysicsTick: 40,
        moveX: 0,
        moveZ: 1,
        verticalIntent: 0,
        jumpHeld: false,
      },
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

  it('closes before blocked input RPC requests can exhaust the Authority lane budget', async () => {
    const socket = new FakeSocket();
    const receiveInput = vi.fn(() => new Promise<never>(() => {}));
    const authority = {
      receiveInput,
      latestSnapshot: () => ready.snapshot,
      subscribePublication: () => () => undefined,
      clearInput: async () => undefined,
      cancelBaselineCapture: async () => ({ status: 'cancelled' }),
    } as unknown as NodeAuthorityLane;
    let serverInputSequence = 0;
    createSession(
      socket as never,
      authority,
      ref,
      ready,
      'node-checkpoint',
      () => undefined,
      () => serverInputSequence++,
      () => 1,
      () => 1,
    );

    for (let sequence = 0; sequence < 33; sequence += 1) socket.emit('message', input(sequence), true);
    await vi.waitFor(() => expect(socket.closed).toMatchObject({ code: 4003 }));
    expect(socket.closed?.reason).toContain('Too many pending input requests');
    expect(receiveInput).toHaveBeenCalledTimes(32);
  });

  it('emits one bounded input summary when the session ends', async () => {
    const socket = new FakeSocket();
    const diagnostics: NodePlayableSessionDiagnosticEvent[] = [];
    const authority = {
      receiveInput: vi.fn(async () => 'accepted' as const),
      latestSnapshot: () => ready.snapshot,
      subscribePublication: () => () => undefined,
      clearInput: async () => undefined,
      cancelBaselineCapture: async () => ({ status: 'cancelled' }),
    } as unknown as NodeAuthorityLane;
    let serverInputSequence = 0;
    createSession(
      socket as never,
      authority,
      ref,
      ready,
      'node-checkpoint',
      () => undefined,
      () => serverInputSequence++,
      () => 1,
      () => 1,
      (event) => diagnostics.push(event),
    );

    socket.emit('message', input(0), true);
    socket.emit('message', input(1, 1), true);
    for (let sequence = 2; sequence < 20; sequence += 1) socket.emit('message', input(sequence), true);
    await vi.waitFor(() => expect(socket.sent).toBe(20));
    socket.emit('close');

    const summaries = diagnostics.filter((event) => event.kind === 'node-playable-input-summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ received: 20, accepted: 19, late: 1, resync: 1 });
    expect(summaries[0]?.samples).toHaveLength(16);
    expect(summaries[0]?.samples.slice(0, 2)).toEqual([
      {
        ordinal: 1,
        inputSequence: 0,
        targetPhysicsTick: 20,
        currentTickAtAdmission: 1,
        expiresAfterPhysicsTick: 40,
        moveX: 0,
        moveZ: 1,
        decision: 'accepted',
      },
      {
        ordinal: 2,
        inputSequence: 1,
        targetPhysicsTick: 1,
        currentTickAtAdmission: 1,
        expiresAfterPhysicsTick: 40,
        moveX: 0,
        moveZ: 1,
        decision: 'late',
      },
    ]);
    expect(summaries[0]?.latestAuthorityPosition).toEqual([0.5, 40, 0.5]);
    expect(JSON.stringify(summaries[0])).not.toContain('checkpoint-session');
  });

  it('reports bounded anonymous baseline stages without exposing the requested key', async () => {
    const socket = new FakeSocket();
    const diagnostics: NodePlayableSessionDiagnosticEvent[] = [];
    const captureBaseline = vi.fn(async (request: { captureId: number; purpose: 'mesh'; key: string }) => ({
      status: 'unavailable' as const,
      captureId: request.captureId,
      captureGeneration: request.captureId,
      purpose: request.purpose,
      key: request.key,
      reason: 'not-available' as const,
    }));
    const authority = {
      captureBaseline,
      latestSnapshot: () => ready.snapshot,
      subscribePublication: () => () => undefined,
      clearInput: async () => undefined,
      cancelBaselineCapture: async () => ({ status: 'cancelled' }),
    } as unknown as NodeAuthorityLane;
    let captureId = 0;
    const session = createSession(
      socket as never,
      authority,
      ref,
      ready,
      'node-checkpoint',
      () => undefined,
      () => 1,
      () => 1,
      () => ++captureId,
      (event) => diagnostics.push(event),
    );

    for (let requestId = 1; requestId <= 20; requestId += 1) socket.emit('message', interest(requestId), true);
    await vi.waitFor(() => expect(captureBaseline).toHaveBeenCalledTimes(20));
    await session.whenDrained();
    session.close();

    const baselineDiagnostics = diagnostics.filter((event) => event.kind === 'node-playable-baseline-diagnostic');
    expect(diagnostics.length).toBeLessThanOrEqual(96);
    expect(baselineDiagnostics.length).toBeLessThanOrEqual(95);
    expect(diagnostics.filter((event) => event.kind === 'node-playable-input-summary')).toHaveLength(1);
    expect(Math.max(...baselineDiagnostics.map((event) => event.requestOrdinal))).toBe(12);
    expect(baselineDiagnostics.filter((event) => event.requestOrdinal === 1).map((event) => event.stage)).toEqual([
      'tail-queued',
      'tail-start',
      'capture-start',
      'capture-complete',
      'projection-complete',
      'send-complete',
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain('0,1,0');
    expect(Object.keys(baselineDiagnostics[0]!).sort()).toEqual(
      ['elapsedMs', 'kind', 'queueDepth', 'requestOrdinal', 'stage'].sort(),
    );
  });
});
