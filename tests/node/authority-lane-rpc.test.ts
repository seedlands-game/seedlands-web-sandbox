import { describe, expect, it } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import { measureNodeRpcBytes } from '../../src/node/runtime/node-rpc-bytes';
import {
  attachNodeRpcServer,
  createNodeRpcClient,
  type NodeRpcPort,
  type NodeRpcRequest,
  type NodeRpcWireMessage,
} from '../../src/node/runtime/node-rpc-contract';

type PortEvent = 'message' | 'close' | 'messageerror';
type Listener = (value?: unknown) => void;

class MemoryPort implements NodeRpcPort {
  private readonly listeners = new Map<PortEvent, Set<Listener>>();
  private isClosed = false;
  peer: MemoryPort | null = null;

  postMessage(value: unknown): void {
    if (this.isClosed || !this.peer || this.peer.isClosed) return;
    this.peer.emit('message', value);
  }

  on(event: PortEvent, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: PortEvent, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.emit('close');
    this.peer?.emit('close');
  }

  emit(event: PortEvent, value?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
}

function ports(): readonly [MemoryPort, MemoryPort] {
  const left = new MemoryPort();
  const right = new MemoryPort();
  left.peer = right;
  right.peer = left;
  return [left, right];
}

function payload(value: unknown): { value: unknown; bytes: number } {
  const bytes = JSON.stringify(value).length;
  return { value, bytes };
}

const limits = {
  maxRequests: 4,
  maxQueuedBytes: 64,
  maxInFlightBytes: 64,
  maxResponseBytes: 64,
  maxReservedResponseBytes: 64,
  maxConcurrentRequests: 1,
};

describe('Authority lane Node RPC ledger', () => {
  it('跨 structured clone 保持 DTO 内容字节相同，并拒绝引用图', () => {
    const value = { name: 'authority', bytes: new Uint8Array([1, 2, 3]), nested: { tick: 7 } };
    expect(measureNodeRpcBytes(structuredClone(value))).toBe(measureNodeRpcBytes(value));
    const shared = { value: 1 };
    expect(() => measureNodeRpcBytes({ left: shared, right: shared })).toThrow(/共享对象引用/);
  });

  it('用实际 payload 字节与响应确认维持请求、在途和回复预算', async () => {
    const [clientPort, serverPort] = ports();
    const server = attachNodeRpcServer({
      port: serverPort,
      epoch: 'epoch-a',
      generation: 3,
      limits,
      validateRequest: (_kind, value) => payload(value),
      validateResponse: (_kind, value) => payload(value),
      handle: async ({ payload: request }) => ({ payload: { echoed: request } }),
    });
    const client = createNodeRpcClient({
      port: clientPort,
      epoch: 'epoch-a',
      generation: 3,
      limits,
      validateRequest: (_kind, value) => payload(value),
      validateResponse: (_kind, value) => payload(value),
    });

    await expect(client.request('echo', { chunk: '0,0,0' })).resolves.toEqual({ echoed: { chunk: '0,0,0' } });
    expect(client.diagnostics()).toMatchObject({ accepted: 1, pending: 0, queuedBytes: 0, inFlightBytes: 0 });
    expect(server.diagnostics()).toMatchObject({
      accepted: 1,
      pending: 0,
      queuedBytes: 0,
      inFlightBytes: 0,
      responseBytes: 0,
    });
    client.close();
    server.close();
  });

  it('错误 epoch、重复迟到回复、超时和端口关闭都会结算 accepted Promise', async () => {
    {
      const [clientPort, peer] = ports();
      const client = createNodeRpcClient({
        port: clientPort,
        epoch: 'epoch-a',
        generation: 3,
        limits,
        validateRequest: (_kind, value) => payload(value),
        validateResponse: (_kind, value) => payload(value),
      });
      const requests: NodeRpcWireMessage[] = [];
      peer.on('message', (message) => {
        if ((message as NodeRpcWireMessage).type === 'request') requests.push(message as NodeRpcWireMessage);
      });

      const firstReply = client.request('echo', { n: 1 });
      expect(requests).toHaveLength(1);
      const first = requests[0] as NodeRpcRequest;
      peer.postMessage({
        type: 'response',
        epoch: first.epoch,
        generation: first.generation,
        requestId: first.requestId,
        kind: first.kind,
        ok: true,
        payload: { n: 1 },
        payloadBytes: payload({ n: 1 }).bytes,
      });
      await expect(firstReply).resolves.toEqual({ n: 1 });

      const next = client.request('echo', { n: 2 });
      peer.postMessage({ type: 'close', epoch: 'old-epoch', generation: 3, reason: 'old lane' });
      expect(client.diagnostics()).toMatchObject({ pending: 1, closed: false, staleMessages: 1 });
      peer.postMessage({
        type: 'response',
        epoch: first.epoch,
        generation: first.generation,
        requestId: first.requestId,
        kind: first.kind,
        ok: true,
        payload: { n: 1 },
        payloadBytes: payload({ n: 1 }).bytes,
      });
      expect(client.diagnostics().pending).toBe(1);
      const second = requests[1] as NodeRpcRequest;
      peer.postMessage({
        type: 'response',
        epoch: second.epoch,
        generation: second.generation,
        requestId: second.requestId,
        kind: second.kind,
        ok: true,
        payload: { n: 2 },
        payloadBytes: payload({ n: 2 }).bytes,
      });
      await expect(next).resolves.toEqual({ n: 2 });

      const [invalidClientPort, invalidPeer] = ports();
      const invalidClient = createNodeRpcClient({
        port: invalidClientPort,
        epoch: 'epoch-a',
        generation: 3,
        limits,
        validateRequest: (_kind, value) => payload(value),
        validateResponse: (_kind, value) => payload(value),
      });
      const invalidRequests: NodeRpcWireMessage[] = [];
      invalidPeer.on('message', (message) => {
        if ((message as NodeRpcWireMessage).type === 'request') invalidRequests.push(message as NodeRpcWireMessage);
      });
      const invalidIdentity = invalidClient.request('echo', { n: 9 });
      const invalidRequest = invalidRequests[0] as NodeRpcRequest;
      invalidPeer.postMessage({
        type: 'response',
        epoch: 'wrong',
        generation: invalidRequest.generation,
        requestId: invalidRequest.requestId,
        kind: invalidRequest.kind,
        ok: true,
        payload: { n: 9 },
        payloadBytes: payload({ n: 9 }).bytes,
      });
      await expect(invalidIdentity).rejects.toThrow(/violated|identity/i);

      const timeout = client.request('echo', { n: 3 }, { timeoutMs: 10 });
      await expect(timeout).rejects.toThrow(/timed out/i);

      const [closingPort, closingPeer] = ports();
      const closingClient = createNodeRpcClient({
        port: closingPort,
        epoch: 'epoch-a',
        generation: 3,
        limits,
        validateRequest: (_kind, value) => payload(value),
        validateResponse: (_kind, value) => payload(value),
      });
      closingPeer.on('message', () => undefined);
      const closing = closingClient.request('echo', { n: 4 });
      closingClient.close();
      await expect(closing).rejects.toThrow(/closed/i);
    }
  });

  it('撤回 queued 请求不会发送，并以关闭 lane 终结在途超时的回复预留', async () => {
    const narrowLimits = { ...limits, maxInFlightBytes: 8 };
    const [clientPort, peer] = ports();
    const client = createNodeRpcClient({
      port: clientPort,
      epoch: 'epoch-a',
      generation: 3,
      limits: narrowLimits,
      validateRequest: (_kind, value) => payload(value),
      validateResponse: (_kind, value) => payload(value),
    });
    const sent: NodeRpcWireMessage[] = [];
    peer.on('message', (message) => sent.push(message as NodeRpcWireMessage));
    const first = client.request('echo', { n: 1 });
    const abort = new AbortController();
    const queued = client.request('echo', { n: 2 }, { signal: abort.signal });
    expect(sent).toHaveLength(1);
    abort.abort();
    await expect(queued).rejects.toThrow(/aborted/i);
    expect(sent).toHaveLength(1);
    expect(client.diagnostics()).toMatchObject({ pending: 1, queuedBytes: 0, inFlightBytes: 7 });
    client.close();
    await expect(first).rejects.toThrow(/closed/i);

    const [timeoutPort, serverPort] = ports();
    const server = attachNodeRpcServer({
      port: serverPort,
      epoch: 'epoch-a',
      generation: 3,
      limits,
      validateRequest: (_kind, value) => payload(value),
      validateResponse: (_kind, value) => payload(value),
      handle: async ({ signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
        ),
    });
    const timedClient = createNodeRpcClient({
      port: timeoutPort,
      epoch: 'epoch-a',
      generation: 3,
      limits,
      validateRequest: (_kind, value) => payload(value),
      validateResponse: (_kind, value) => payload(value),
    });
    const timed = timedClient.request('save', { n: 5 }, { timeoutMs: 10 });
    expect(server.diagnostics()).toMatchObject({ pending: 1, responseBytes: 64 });
    await expect(timed).rejects.toThrow(/timed out/i);
    expect(server.diagnostics()).toMatchObject({ closed: true, pending: 0, responseBytes: 0, inFlightBytes: 0 });
  });

  it('重复 requestId 或错误回复确认会关闭专用端口并结算双方账本', async () => {
    const blocked = async ({ signal }: { signal: AbortSignal }) =>
      new Promise<never>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
      );
    const [duplicateClientPort, duplicateServerPort] = ports();
    const duplicateServer = attachNodeRpcServer({
      port: duplicateServerPort,
      epoch: 'epoch-a',
      generation: 3,
      limits,
      validateRequest: (_kind, value) => payload(value),
      validateResponse: (_kind, value) => payload(value),
      handle: blocked,
    });
    const duplicateClient = createNodeRpcClient({
      port: duplicateClientPort,
      epoch: 'epoch-a',
      generation: 3,
      limits,
      validateRequest: (_kind, value) => payload(value),
      validateResponse: (_kind, value) => payload(value),
    });
    const original = duplicateClient.request('save', { id: 0 });
    duplicateClientPort.postMessage({
      type: 'request',
      epoch: 'epoch-a',
      generation: 3,
      requestId: 0,
      kind: 'save',
      payload: { id: 0 },
      payloadBytes: 8,
    });
    await expect(original).rejects.toThrow(/strictly|closed|violated/i);
    expect(duplicateClient.diagnostics()).toMatchObject({ pending: 0, inFlightBytes: 0, queuedBytes: 0 });
    expect(duplicateServer.diagnostics()).toMatchObject({
      closed: true,
      pending: 0,
      inFlightBytes: 0,
      responseBytes: 0,
    });

    const [ackClientPort, ackServerPort] = ports();
    const ackServer = attachNodeRpcServer({
      port: ackServerPort,
      epoch: 'epoch-a',
      generation: 3,
      limits,
      validateRequest: (_kind, value) => payload(value),
      validateResponse: (_kind, value) => payload(value),
      handle: blocked,
    });
    const ackClient = createNodeRpcClient({
      port: ackClientPort,
      epoch: 'epoch-a',
      generation: 3,
      limits,
      validateRequest: (_kind, value) => payload(value),
      validateResponse: (_kind, value) => payload(value),
    });
    const first = ackClient.request('save', { id: 1 });
    const second = ackClient.request('save', { id: 2 });
    ackClientPort.postMessage({
      type: 'response-ack',
      epoch: 'epoch-a',
      generation: 3,
      requestId: 0,
      kind: 'wrong',
      payloadBytes: 0,
    });
    await expect(Promise.allSettled([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 'rejected' }),
      expect.objectContaining({ status: 'rejected' }),
    ]);
    expect(ackClient.diagnostics()).toMatchObject({ pending: 0, inFlightBytes: 0, queuedBytes: 0 });
    expect(ackServer.diagnostics()).toMatchObject({ closed: true, pending: 0, inFlightBytes: 0, responseBytes: 0 });
  });

  it('直接兼容 worker_threads MessageChannel，而非 DOM MessagePort', async () => {
    const channel = new MessageChannel();
    const server = attachNodeRpcServer({
      port: channel.port2,
      epoch: 'epoch-a',
      generation: 3,
      limits,
      validateRequest: (_kind, value) => payload(value),
      validateResponse: (_kind, value) => payload(value),
      handle: async ({ payload: request }) => ({ payload: request }),
    });
    const client = createNodeRpcClient({
      port: channel.port1,
      epoch: 'epoch-a',
      generation: 3,
      limits,
      validateRequest: (_kind, value) => payload(value),
      validateResponse: (_kind, value) => payload(value),
    });
    await expect(client.request('echo', { node: true })).resolves.toEqual({ node: true });
    client.close();
    server.close();
  });

  it('向 owner 暴露可区分主动关闭与协议失败的 client 终态', async () => {
    const [localPort] = ports();
    const local = createNodeRpcClient({
      port: localPort,
      epoch: 'epoch-a',
      generation: 3,
      limits,
      validateRequest: (_kind, value) => payload(value),
      validateResponse: (_kind, value) => payload(value),
    });
    local.close();
    await expect(local.whenClosed()).resolves.toMatchObject({
      cause: 'local-close',
      error: expect.objectContaining({ name: 'NodeRpcClosedError' }),
    });

    const [protocolPort, peer] = ports();
    const protocol = createNodeRpcClient({
      port: protocolPort,
      epoch: 'epoch-a',
      generation: 3,
      limits,
      validateRequest: (_kind, value) => payload(value),
      validateResponse: (_kind, value) => payload(value),
    });
    let request!: NodeRpcRequest;
    peer.on('message', (message) => {
      if ((message as NodeRpcWireMessage).type === 'request') request = message as NodeRpcRequest;
    });
    const pending = protocol.request('echo', { value: 1 });
    peer.postMessage({
      type: 'response',
      epoch: request.epoch,
      generation: request.generation,
      requestId: request.requestId,
      kind: request.kind,
      ok: true,
      payload: { value: 1 },
      payloadBytes: 0,
    });
    await expect(pending).rejects.toThrow(/byte mismatch|validation failed/i);
    await expect(protocol.whenClosed()).resolves.toMatchObject({
      cause: 'protocol-error',
      error: expect.objectContaining({ name: 'NodeRpcProtocolError' }),
    });

    const [peerClosePort, peerCloser] = ports();
    const peerClosed = createNodeRpcClient({
      port: peerClosePort,
      epoch: 'epoch-a',
      generation: 3,
      limits,
      validateRequest: (_kind, value) => payload(value),
      validateResponse: (_kind, value) => payload(value),
    });
    peerCloser.postMessage({ type: 'close', epoch: 'epoch-a', generation: 3, reason: 'peer stopped' });
    await expect(peerClosed.whenClosed()).resolves.toMatchObject({ cause: 'peer-close' });

    const [transportPort, disconnectedPeer] = ports();
    const transportClosed = createNodeRpcClient({
      port: transportPort,
      epoch: 'epoch-a',
      generation: 3,
      limits,
      validateRequest: (_kind, value) => payload(value),
      validateResponse: (_kind, value) => payload(value),
    });
    disconnectedPeer.close();
    await expect(transportClosed.whenClosed()).resolves.toMatchObject({ cause: 'transport-close' });
  });

  it('server close 后仍记录已开始 handler，并在真实完成后才 idle', async () => {
    const [clientPort, serverPort] = ports();
    let finish!: () => void;
    const handlerDone = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const server = attachNodeRpcServer({
      port: serverPort,
      epoch: 'epoch-a',
      generation: 3,
      limits,
      validateRequest: (_kind, value) => payload(value),
      validateResponse: (_kind, value) => payload(value),
      handle: async () => {
        await handlerDone;
        return { payload: { saved: true } };
      },
    });
    const client = createNodeRpcClient({
      port: clientPort,
      epoch: 'epoch-a',
      generation: 3,
      limits,
      validateRequest: (_kind, value) => payload(value),
      validateResponse: (_kind, value) => payload(value),
    });
    const request = client.request('save', { value: 1 });
    expect(server.diagnostics()).toMatchObject({ pending: 1, activeHandlers: 1, inFlightBytes: 11 });

    server.close();
    await expect(request).rejects.toThrow(/closed/i);
    expect(server.diagnostics()).toMatchObject({
      closed: true,
      pending: 1,
      activeHandlers: 1,
      inFlightBytes: 11,
      responseBytes: 64,
    });
    let idle = false;
    const whenIdle = server.whenIdle().then(() => {
      idle = true;
    });
    await Promise.resolve();
    expect(idle).toBe(false);
    finish();
    await whenIdle;
    expect(server.diagnostics()).toMatchObject({
      closed: true,
      pending: 0,
      activeHandlers: 0,
      inFlightBytes: 0,
      responseBytes: 0,
    });
  });
});
