import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthorityReady } from '../../packages/game-core/src/compute/authority-worker-protocol';
import type { AuthoritySnapshot } from '../../packages/game-core/src/server/authority/authority-session';
import { decodeC0Envelope, encodeC0Envelope } from '../../packages/game-core/src/server/protocol/network-c0-codec';
import type {
  PlayablePublicOutboundMessage,
  PublicSessionRef,
} from '../../packages/game-core/src/server/protocol/network-message-semantics';
import type {
  InputCommand,
  SequenceDecision,
  SessionEpoch,
} from '../../packages/game-core/src/runtime/session-protocol';
import type { NodeAuthorityLane } from '../../apps/node-server/src/node/runtime/node-authority-lane';
import { createSession } from '../../apps/node-server/src/node/server/node-playable-network-session';
import { RemoteAuthorityClient } from '../../apps/web/src/client/authority/remote-authority-client';
import { parseLocalPlayableUrl } from '../../apps/web/src/client/authority/remote-authority-projections';

const utf8 = {
  encode: (value: string) => new TextEncoder().encode(value),
  decodeFatal: (value: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(value),
};
const clientEpoch = 'remote-client-test' as SessionEpoch;
const serverEpoch = 'remote-server-test';
const ref: PublicSessionRef = {
  protocolVersion: 1,
  sessionEpoch: 'remote-session-test',
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
const snapshot = {
  kind: 'snapshot',
  protocolVersion: 1,
  epoch: clientEpoch,
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
} as AuthoritySnapshot;
const ready = {
  playerId: 'player-1',
  playerBodyPosition: [0.5, 40, 0.5],
  isNew: true,
  seed: 1,
  seedText: 'remote-input-backpressure',
  generatorVersion: 1,
  worldTime: 0,
  frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
  snapshot,
  gameplay: undefined,
} as unknown as AuthorityReady;

class BrowserSocket {
  readyState = 1;
  bufferedAmount = 0;
  readonly frames: Uint8Array[] = [];
  onSend: ((data: Uint8Array) => void) | null = null;

  send(data: Uint8Array): void {
    const copy = data.slice();
    this.frames.push(copy);
    this.onSend?.(copy);
  }

  close(): void {
    this.readyState = 3;
  }
}

class SessionSocket extends EventEmitter {
  readonly readyState = 1;
  readonly bufferedAmount = 0;
  readonly frames: Uint8Array[] = [];
  closed: Readonly<{ code?: number; reason?: string }> | null = null;

  send(data: Uint8Array, _options: unknown, callback: (error?: Error) => void): void {
    this.frames.push(data.slice());
    callback();
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
}

type ClientInternals = {
  ref: PublicSessionRef;
  serverEpoch: string;
  readyValue: AuthorityReady;
  snapshotValue: AuthoritySnapshot;
  snapshotReceivedAtMs: number;
  receive(data: unknown): Promise<AuthorityReady | null>;
  fail(error: Error): void;
};

const createClient = (
  options: Readonly<{
    onInputDecision?: (decision: { sequence: number; decision: SequenceDecision; requiresResync: boolean }) => void;
  }> = {},
) => {
  vi.stubGlobal('WebSocket', { OPEN: 1 });
  const socket = new BrowserSocket();
  const client = Reflect.construct(RemoteAuthorityClient, [socket, clientEpoch, options]) as RemoteAuthorityClient;
  const internals = client as unknown as ClientInternals;
  Object.assign(internals, {
    ref,
    serverEpoch,
    readyValue: ready,
    snapshotValue: snapshot,
    snapshotReceivedAtMs: performance.now(),
  });
  return { client, internals, socket };
};

const command = (
  sequence: number,
  moveZ = sequence / 100,
  jumpPressed = false,
  issuedAtMs = performance.now(),
): InputCommand => ({
  kind: 'input',
  protocolVersion: 1,
  epoch: clientEpoch,
  stream: 'player-input',
  sequence,
  targetPhysicsTick: 10 + sequence,
  issuedAtMs,
  state: { moveX: 0, moveZ, verticalIntent: 0, jumpHeld: jumpPressed },
  edges: { jumpPressed },
});

const messages = (socket: BrowserSocket) =>
  socket.frames.map((frame) => decodeC0Envelope(frame, utf8).message as Record<string, unknown>);

const inputStates = (socket: BrowserSocket) => messages(socket).filter((message) => message.kind === 'input-state');

const deliverDecision = async (
  internals: ClientInternals,
  inputSequence: number,
  requiresResync = false,
): Promise<void> => {
  const encoded = encodeC0Envelope(
    {
      messageClass: 'input-decision',
      message: {
        kind: 'input-decision',
        ref,
        inputSequence,
        decision: requiresResync ? 'late' : 'accepted',
        requiresResync,
      } satisfies PlayablePublicOutboundMessage,
      blocks: [],
    },
    utf8,
  );
  await internals.receive(encoded.slice().buffer);
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RemoteAuthorityClient boundary', () => {
  it('rejects local administrative mutations instead of forwarding an internal RPC', async () => {
    const client = Object.create(RemoteAuthorityClient.prototype) as RemoteAuthorityClient;
    await expect(client.editWorld()).rejects.toThrow(/远端模式不开放/);
    await expect(client.setPlayerPosition()).rejects.toThrow(/远端模式不开放/);
    await expect(client.setWorldTime()).rejects.toThrow(/远端模式不开放/);
  });

  it('accepts only an exact loopback playable websocket URL', () => {
    expect(parseLocalPlayableUrl('ws://127.0.0.1:8787/seedlands')).toBe('ws://127.0.0.1:8787/seedlands');
    expect(parseLocalPlayableUrl('ws://[::1]:8787/seedlands')).toBe('ws://[::1]:8787/seedlands');
    for (const value of [
      'ws://127.0.0.1:80@example.com/seedlands',
      'ws://example.com/seedlands',
      'wss://127.0.0.1:8787/seedlands',
      'ws://127.0.0.1:8787/other',
      'ws://127.0.0.1:8787/seedlands?key=secret',
      'ws://user:secret@127.0.0.1:8787/seedlands',
    ])
      expect(() => parseLocalPlayableUrl(value)).toThrow(/本机/);
  });

  it('keeps one input-state in flight and flushes only the latest state after its matching decision', async () => {
    const { client, internals, socket } = createClient();
    for (let sequence = 0; sequence < 65; sequence += 1) client.sendInput(command(sequence));

    expect(inputStates(socket)).toHaveLength(1);
    expect(inputStates(socket)[0]).toMatchObject({ inputSequence: 0, moveZ: 0 });
    await deliverDecision(internals, 0);
    expect(inputStates(socket)).toHaveLength(2);
    expect(inputStates(socket)[1]).toMatchObject({ inputSequence: 64, moveZ: 0.64 });
    await deliverDecision(internals, 64);
    expect(inputStates(socket)).toHaveLength(2);
  });

  it('retains one coalesced jump in the latest state tick window but never revives it after its original lease', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const live = createClient();
    live.client.sendInput(command(0, 0, false, 0));
    live.client.sendInput(command(1, 0.1, true, 0));
    live.client.sendInput(command(2, 0.2, false, 0));
    await deliverDecision(live.internals, 0);
    const liveMessages = messages(live.socket);
    const edge = liveMessages.find((message) => message.kind === 'input-edge');
    const state = liveMessages.find((message) => message.kind === 'input-state' && message.inputSequence === 2);
    expect(edge).toMatchObject({ type: 'jump-pressed' });
    expect(edge).toMatchObject({
      targetPhysicsTick: state?.targetPhysicsTick,
      expiresAfterPhysicsTick: state?.expiresAfterPhysicsTick,
    });

    const expired = createClient();
    expired.client.sendInput(command(0, 0, false, 0));
    expired.client.sendInput(command(1, 0.1, true, 0));
    expired.client.sendInput(command(2, 0.2, false, 0));
    clock.mockReturnValue(501);
    await deliverDecision(expired.internals, 0);
    expect(messages(expired.socket).filter((message) => message.kind === 'input-edge')).toHaveLength(0);
    expect(inputStates(expired.socket).at(-1)).toMatchObject({ inputSequence: 2, moveZ: 0.2 });
  });

  it('drops queued state for resync or close and never lets an old decision unlock a newer input', async () => {
    const decisions = vi.fn();
    const active = createClient({ onInputDecision: decisions });
    active.client.sendInput(command(0));
    active.client.sendInput(command(1));
    await deliverDecision(active.internals, 9);
    expect(inputStates(active.socket)).toHaveLength(1);
    await deliverDecision(active.internals, 0, true);
    expect(inputStates(active.socket)).toHaveLength(1);
    expect(decisions).toHaveBeenLastCalledWith({ sequence: 0, decision: 'late', requiresResync: true });

    active.client.sendInput(command(2));
    active.client.sendInput(command(3));
    await deliverDecision(active.internals, 0);
    expect(inputStates(active.socket)).toHaveLength(2);
    await deliverDecision(active.internals, 2);
    expect(inputStates(active.socket).at(-1)).toMatchObject({ inputSequence: 3 });

    const closed = createClient();
    closed.client.sendInput(command(0));
    closed.client.sendInput(command(1));
    closed.client.dispose();
    await deliverDecision(closed.internals, 0);
    expect(inputStates(closed.socket)).toHaveLength(1);

    const failed = createClient();
    failed.client.sendInput(command(0));
    failed.client.sendInput(command(1));
    failed.internals.fail(new Error('synthetic transport failure'));
    await deliverDecision(failed.internals, 0);
    expect(inputStates(failed.socket)).toHaveLength(1);
  });

  it('keeps a slow Authority at one input RPC while more than 32 normal client samples coalesce', async () => {
    const browser = createClient();
    const serverSocket = new SessionSocket();
    browser.socket.onSend = (data) => serverSocket.emit('message', data, true);
    let activeInputs = 0;
    let maxActiveInputs = 0;
    const received: InputCommand[] = [];
    const finish: Array<(decision: SequenceDecision) => void> = [];
    const receiveInput = vi.fn(
      (input: InputCommand) =>
        new Promise<SequenceDecision>((resolve) => {
          received.push(input);
          activeInputs += 1;
          maxActiveInputs = Math.max(maxActiveInputs, activeInputs);
          finish.push((decision) => {
            activeInputs -= 1;
            resolve(decision);
          });
        }),
    );
    const authority = {
      receiveInput,
      latestSnapshot: () => ({ ...snapshot, epoch: serverEpoch }),
      subscribePublication: () => () => undefined,
      clearInput: async () => undefined,
      cancelBaselineCapture: async () => ({ status: 'cancelled' }),
    } as unknown as NodeAuthorityLane;
    const session = createSession(
      serverSocket as never,
      authority,
      ref,
      { ...ready, snapshot: { ...snapshot, epoch: serverEpoch } } as AuthorityReady,
      serverEpoch,
      () => undefined,
      (() => {
        let sequence = 0;
        return () => sequence++;
      })(),
      () => 1,
      () => 1,
    );

    for (let sequence = 0; sequence < 65; sequence += 1) browser.client.sendInput(command(sequence));
    await vi.waitFor(() => expect(receiveInput).toHaveBeenCalledTimes(1));
    expect(maxActiveInputs).toBe(1);
    expect(serverSocket.closed).toBeNull();

    finish[0]!('accepted');
    await vi.waitFor(() => expect(serverSocket.frames).toHaveLength(1));
    await browser.internals.receive(serverSocket.frames.shift()!.slice().buffer);
    await vi.waitFor(() => expect(receiveInput).toHaveBeenCalledTimes(2));
    expect(maxActiveInputs).toBe(1);
    expect(received[1]?.state.moveZ).toBe(0.64);
    expect(inputStates(browser.socket).at(-1)).toMatchObject({ inputSequence: 64, moveZ: 0.64 });

    finish[1]!('accepted');
    await vi.waitFor(() => expect(serverSocket.frames).toHaveLength(1));
    await browser.internals.receive(serverSocket.frames.shift()!.slice().buffer);
    expect(receiveInput).toHaveBeenCalledTimes(2);
    expect(serverSocket.closed).toBeNull();
    session.close();
    browser.client.dispose();
  });
});
