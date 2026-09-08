import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { decodeC0Envelope, encodeC0Envelope } from '../../packages/game-core/src/server/protocol/network-c0-codec';
import type { PublicSessionRef } from '../../packages/game-core/src/server/protocol/network-message-semantics';
import { createNodePlayableNetworkServer } from '../../apps/node-server/src/node/server/node-playable-network-server';
import {
  createNodeServerRuntime,
  type NodeServerRuntime,
} from '../../apps/node-server/src/node/server/node-server-runtime';
import { buildNodeServerArtifactFixture } from './support/node-server-artifact-fixture';
import type { NodeAuthorityLane } from '../../apps/node-server/src/node/runtime/node-authority-lane';

type Client = {
  once(event: string, listener: (...args: never[]) => void): void;
  off(event: string, listener: (...args: never[]) => void): void;
  send(data: Uint8Array, options?: Readonly<Record<string, unknown>>): void;
  close(): void;
  terminate(): void;
};
type ClientConstructor = new (url: string, options: Readonly<Record<string, unknown>>) => Client;

const WebSocketClient = createRequire(import.meta.url)('../../apps/node-server/node_modules/ws') as ClientConstructor;
const utf8 = {
  encode: (value: string) => new TextEncoder().encode(value),
  decodeFatal: (value: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(value),
};
const origin = 'http://127.0.0.1:4173';
const accessKey = 'network-integration-synthetic-key';
let dataDirectory = '';
let artifact: Awaited<ReturnType<typeof buildNodeServerArtifactFixture>>;
let runtime: NodeServerRuntime;
let network: Awaited<ReturnType<typeof createNodePlayableNetworkServer>>;
const clients = new Set<Client>();

const messageBytes = (value: unknown): Uint8Array => {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error('Expected a binary WebSocket frame.');
};

const encode = (
  messageClass: Parameters<typeof encodeC0Envelope>[0]['messageClass'],
  message: Record<string, unknown>,
) => encodeC0Envelope({ messageClass, message, blocks: [] }, utf8);

const waitForOpen = (client: Client) =>
  new Promise<void>((resolveOpen, reject) => {
    client.once('open', resolveOpen);
    client.once('error', reject);
  });

const waitForClose = (client: Client) =>
  new Promise<Readonly<{ code: number; reason: string }>>((resolveClose, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket did not close.')), 3_000);
    client.once('close', (code: number, reason: Uint8Array) => {
      clearTimeout(timer);
      clients.delete(client);
      resolveClose({ code, reason: utf8.decodeFatal(reason) });
    });
  });

const nextMessage = (client: Client) =>
  new Promise<ReturnType<typeof decodeC0Envelope>>((resolveMessage, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket did not publish a message.')), 3_000);
    client.once('message', (value: unknown) => {
      clearTimeout(timer);
      try {
        resolveMessage(decodeC0Envelope(messageBytes(value), utf8));
      } catch (error) {
        reject(error);
      }
    });
  });

async function openClient(): Promise<Client> {
  const client = new WebSocketClient(network.url, { origin });
  clients.add(client);
  await waitForOpen(client);
  return client;
}

function sendHello(client: Client, key = accessKey): void {
  client.send(
    encode('session-hello', {
      kind: 'session-hello',
      protocolVersion: 1,
      transport: 'experimental-local-c0-v1',
      accessKey: key,
    }),
    { binary: true },
  );
}

async function connect(): Promise<Readonly<{ client: Client; ref: PublicSessionRef }>> {
  const client = await openClient();
  const incoming = nextMessage(client);
  sendHello(client);
  const welcome = await incoming;
  expect(welcome.messageClass).toBe('welcome');
  return { client, ref: welcome.message.ref as PublicSessionRef };
}

async function closeClient(client: Client): Promise<void> {
  const closed = waitForClose(client);
  client.close();
  await closed;
}

async function nextMessageClass(client: Client, messageClass: string): Promise<ReturnType<typeof decodeC0Envelope>> {
  for (;;) {
    const envelope = await nextMessage(client);
    if (envelope.messageClass === messageClass) return envelope;
  }
}

async function nextAuthorityTick(client: Client): Promise<number> {
  const envelope = await nextMessageClass(client, 'authority-state');
  const correction = envelope.message.correction as Readonly<{ physicsTick: number }>;
  return correction.physicsTick;
}

describe('real Node playable WebSocket transport', () => {
  beforeAll(async () => {
    artifact = await buildNodeServerArtifactFixture('seedlands-network-artifact-');
    dataDirectory = await mkdtemp(join(tmpdir(), 'seedlands-network-integration-'));
    const keyFile = join(dataDirectory, 'access-key');
    await writeFile(keyFile, `${accessKey}\n`, { mode: 0o600 });
    runtime = await createNodeServerRuntime({
      dataDirectory,
      seedText: 'network-integration',
      computeMode: 'inline',
      entries: {
        authority: artifact.entry('node-authority-worker'),
        persistence: artifact.entry('node-persistence-worker'),
        worker: artifact.entry('node-compute-worker'),
        child: artifact.entry('node-compute-child'),
      },
    });
    network = await createNodePlayableNetworkServer(runtime.authority, {
      hostname: '127.0.0.1',
      port: 0,
      origin,
      accessKeyFile: keyFile,
    });
    runtime.attachNetwork(() => network.close());
  });

  afterAll(async () => {
    for (const client of clients) client.terminate();
    if (typeof runtime !== 'undefined') await runtime.stop();
    if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
    if (typeof artifact !== 'undefined') await artifact.close();
  });

  it('rejects a foreign Origin and an invalid access key before occupying the single-player slot', async () => {
    const foreign = new WebSocketClient(network.url, { origin: 'http://outside.invalid' });
    const rejected = new Promise<number>((resolveReject, reject) => {
      foreign.once('unexpected-response', (_request: unknown, response: Readonly<{ statusCode?: number }>) =>
        resolveReject(response.statusCode ?? 0),
      );
      foreign.once('open', () => reject(new Error('Foreign Origin unexpectedly connected.')));
      foreign.once('error', () => undefined);
    });
    await expect(rejected).resolves.toBe(403);

    const client = await openClient();
    const closed = waitForClose(client);
    sendHello(client, 'wrong-key');
    await expect(closed).resolves.toEqual({ code: 4004, reason: 'authentication' });
  });

  it('enforces one active player and accepts sequence zero again after a manual reconnect', async () => {
    const first = await connect();
    const tick = await nextAuthorityTick(first.client);
    const decision = nextMessageClass(first.client, 'input-decision');
    first.client.send(
      encode('input-state', {
        kind: 'input-state',
        ref: first.ref,
        inputSequence: 0,
        targetPhysicsTick: tick + 20,
        expiresAfterPhysicsTick: tick + 40,
        moveX: 0,
        moveZ: 1,
        verticalIntent: 0,
        jumpHeld: false,
      }),
      { binary: true },
    );
    expect((await decision).message).toMatchObject({ kind: 'input-decision', inputSequence: 0, decision: 'accepted' });

    const secondAttempt = await openClient();
    const secondAttemptClosed = waitForClose(secondAttempt);
    sendHello(secondAttempt);
    await expect(secondAttemptClosed).resolves.toEqual({ code: 4005, reason: 'server-full' });
    await closeClient(first.client);

    const reconnected = await connect();
    const reconnectTick = await nextAuthorityTick(reconnected.client);
    const reconnectDecision = nextMessageClass(reconnected.client, 'input-decision');
    reconnected.client.send(
      encode('input-state', {
        kind: 'input-state',
        ref: reconnected.ref,
        inputSequence: 0,
        targetPhysicsTick: reconnectTick + 20,
        expiresAfterPhysicsTick: reconnectTick + 40,
        moveX: 0,
        moveZ: 0,
        verticalIntent: 0,
        jumpHeld: false,
      }),
      { binary: true },
    );
    expect((await reconnectDecision).message).toMatchObject({
      kind: 'input-decision',
      inputSequence: 0,
      decision: 'accepted',
    });
    await closeClient(reconnected.client);
  });

  it('closes malformed protocol traffic and a real message burst without failing Authority', async () => {
    const malformed = await connect();
    await nextAuthorityTick(malformed.client);
    const bytes = encode('heartbeat', { kind: 'heartbeat', ref: malformed.ref, nonce: 1 });
    const marker = utf8.encode('heartbeat');
    const offset = bytes.findIndex((_value, index) => marker.every((entry, inner) => bytes[index + inner] === entry));
    expect(offset).toBeGreaterThanOrEqual(0);
    bytes.set(utf8.encode('xxxxxxxxx'), offset);
    const malformedClose = waitForClose(malformed.client);
    malformed.client.send(bytes, { binary: true });
    await expect(malformedClose).resolves.toEqual({ code: 4003, reason: 'protocol' });

    const burst = await connect();
    await nextAuthorityTick(burst.client);
    const burstClose = waitForClose(burst.client);
    for (let nonce = 0; nonce < 181; nonce += 1)
      burst.client.send(encode('heartbeat', { kind: 'heartbeat', ref: burst.ref, nonce }), { binary: true });
    await expect(burstClose).resolves.toEqual({ code: 4003, reason: 'rate-limit' });
    expect(runtime.state).toBe('running');
  });

  it('closes the real listener promptly while a baseline capture is blocked and ignores its late completion', async () => {
    const keyFile = join(dataDirectory, 'blocked-capture-key');
    await writeFile(keyFile, `${accessKey}\n`, { mode: 0o600 });
    const ready = await runtime.authority.readReady();
    const diagnostics = await runtime.authority.readDiagnostics();
    let finishCapture!: (value: unknown) => void;
    const captureBaseline = vi.fn(
      () =>
        new Promise((resolve) => {
          finishCapture = resolve;
        }),
    );
    const cancelBaselineCapture = vi.fn(async () => ({ status: 'cancelled' }));
    const authority = {
      ...runtime.authority,
      readReady: async () => ready,
      readDiagnostics: async () => diagnostics,
      latestSnapshot: () => ready.snapshot,
      subscribePublication: () => () => undefined,
      captureBaseline,
      cancelBaselineCapture,
      clearInput: async () => undefined,
    } as unknown as NodeAuthorityLane;
    const blockedNetwork = await createNodePlayableNetworkServer(authority, {
      hostname: '127.0.0.1',
      port: 0,
      origin,
      accessKeyFile: keyFile,
    });
    const client = new WebSocketClient(blockedNetwork.url, { origin });
    clients.add(client);
    await waitForOpen(client);
    const welcome = nextMessage(client);
    sendHello(client);
    const welcomeEnvelope = await welcome;
    expect(welcomeEnvelope.messageClass).toBe('welcome');
    const blockedRef = welcomeEnvelope.message.ref as PublicSessionRef;
    client.send(
      encode('interest-update', {
        kind: 'interest-update',
        ref: blockedRef,
        requestId: 1,
        keys: ['0,1,0'],
      }),
      { binary: true },
    );
    await vi.waitFor(() => expect(captureBaseline).toHaveBeenCalledTimes(1));
    const closed = waitForClose(client);
    await expect(blockedNetwork.close()).resolves.toBeUndefined();
    await expect(closed).resolves.toMatchObject({ code: 1001 });
    expect(cancelBaselineCapture).toHaveBeenCalledTimes(1);
    finishCapture({ status: 'unavailable' });
    await Promise.resolve();
  });
});
