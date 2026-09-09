import { afterEach, describe, expect, it } from 'vitest';
import type { ControllerHostMessage } from '@seedlands/cognition-protocol';
import {
  AgentServerWebSocketClient as WebSocket,
  startAgentServer,
  type AgentServerHandle,
} from '../../apps/agent-server/src/node/websocket-host';
import { binding, observation } from './fixtures';

const origin = 'http://127.0.0.1:5173';
const handles: AgentServerHandle[] = [];

type NodeWebSocket = InstanceType<typeof WebSocket>;

function opened(url: string, requestOrigin = origin): Promise<NodeWebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Origin: requestOrigin } });
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function messageQueue(socket: NodeWebSocket): () => Promise<ControllerHostMessage> {
  const queued: ControllerHostMessage[] = [];
  const waiting: ((message: ControllerHostMessage) => void)[] = [];
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString()) as ControllerHostMessage;
    const resolve = waiting.shift();
    if (resolve) resolve(message);
    else queued.push(message);
  });
  return async () => {
    const message = queued.shift();
    return message ?? (await new Promise<ControllerHostMessage>((resolve) => waiting.push(resolve)));
  };
}

function closed(socket: NodeWebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => socket.once('close', () => resolve()));
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
});

describe('loopback WebSocket host', () => {
  it('requires first-frame pairing, freezes the binding, and rejects stale sequences', async () => {
    const handle = await startAgentServer({ model: null, allowedOrigins: [origin], pairingToken: 'pair-test' });
    handles.push(handle);
    const socket = await opened(handle.url);
    const nextMessage = messageQueue(socket);
    socket.send(
      JSON.stringify({
        kind: 'hello',
        protocolVersion: 1,
        binding: binding(),
        sequence: 0,
        pairingToken: handle.pairingToken,
      }),
    );
    expect(await nextMessage()).toMatchObject({ kind: 'ready', binding: binding() });
    expect(await nextMessage()).toMatchObject({ kind: 'status', state: 'fallback', reason: 'missing-key' });
    socket.send(
      JSON.stringify({
        kind: 'control',
        protocolVersion: 1,
        binding: binding(),
        sequence: 0,
        command: 'pause',
      }),
    );
    expect(await nextMessage()).toMatchObject({ kind: 'error', code: 'STALE_SEQUENCE' });
    await closed(socket);
  });

  it('rejects wrong pairing tokens without echoing either token', async () => {
    const handle = await startAgentServer({ model: null, allowedOrigins: [origin], pairingToken: 'correct-token' });
    handles.push(handle);
    const socket = await opened(handle.url);
    const nextMessage = messageQueue(socket);
    socket.send(
      JSON.stringify({
        kind: 'hello',
        protocolVersion: 1,
        binding: binding(),
        sequence: 0,
        pairingToken: 'wrong-token',
      }),
    );
    const message = await nextMessage();
    expect(message).toMatchObject({ kind: 'error', code: 'PAIRING_REJECTED', message: 'pairing rejected' });
    expect(JSON.stringify(message)).not.toContain('correct-token');
    expect(JSON.stringify(message)).not.toContain('wrong-token');
    await closed(socket);
  });

  it('rejects an inconsistent first observation after successful authentication', async () => {
    const handle = await startAgentServer({ model: null, allowedOrigins: [origin], pairingToken: 'pair-test' });
    handles.push(handle);
    const socket = await opened(handle.url);
    const nextMessage = messageQueue(socket);
    socket.send(
      JSON.stringify({
        kind: 'hello',
        protocolVersion: 1,
        binding: binding(),
        sequence: 0,
        pairingToken: handle.pairingToken,
      }),
    );
    expect(await nextMessage()).toMatchObject({ kind: 'ready' });
    expect(await nextMessage()).toMatchObject({ kind: 'status', reason: 'missing-key' });
    socket.send(
      JSON.stringify({
        kind: 'observe',
        protocolVersion: 1,
        binding: binding(),
        sequence: 1,
        observation: observation({
          character: { ...observation().character, eventCursor: Number.MAX_VALUE },
        }),
      }),
    );
    const response = await Promise.race([
      nextMessage(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
    ]);
    expect(response).toMatchObject({ kind: 'error', code: 'BAD_FRAME' });
    await closed(socket);
  });

  it('rejects browser origins outside the exact allowlist before WebSocket upgrade', async () => {
    const handle = await startAgentServer({ model: null, allowedOrigins: [origin] });
    handles.push(handle);
    const error = await new Promise<Error>((resolve) => {
      const socket = new WebSocket(handle.url, { headers: { Origin: 'http://evil.example' } });
      socket.once('error', resolve);
    });
    expect(error.message).toContain('403');
  });
});
