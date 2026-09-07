import { afterEach, describe, expect, it } from 'vitest';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { measureNodeRpcBytes } from '../../src/node/runtime/node-rpc-bytes';
import { attachNodeRpcServer, type NodeRpcResponse } from '../../src/node/runtime/node-rpc-contract';
import {
  authorityCaptureDispatchOrderKey,
  reserveAuthorityResponseBytes,
} from '../../src/node/runtime/node-authority-baseline-protocol';

const EPOCH = 'capture-dispatch-order';
const GENERATION = 0;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const OCCUPY_RESERVATION_BYTES = 3_800_000;

const limits = {
  maxRequests: 8,
  maxQueuedBytes: 64 * 1024,
  maxInFlightBytes: 64 * 1024,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  maxReservedResponseBytes: MAX_RESPONSE_BYTES,
  maxConcurrentRequests: 2,
};

const channels: MessageChannel[] = [];

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

function measured(value: unknown) {
  return { value, bytes: measureNodeRpcBytes(value) };
}

function waitForResponse(port: MessagePort, kind: string): Promise<NodeRpcResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${kind}.`)), 2_000);
    const onMessage = (value: unknown) => {
      const response = value as NodeRpcResponse;
      if (response.type !== 'response' || response.kind !== kind) return;
      clearTimeout(timeout);
      port.off('message', onMessage);
      resolve(response);
    };
    port.on('message', onMessage);
  });
}

function post(port: MessagePort, requestId: number, kind: string, payload: unknown): void {
  const measuredPayload = measured(payload);
  port.postMessage({
    type: 'request',
    epoch: EPOCH,
    generation: GENERATION,
    requestId,
    kind,
    payload: measuredPayload.value,
    payloadBytes: measuredPayload.bytes,
  });
}

function acknowledge(port: MessagePort, response: NodeRpcResponse): void {
  port.postMessage({
    type: 'response-ack',
    epoch: EPOCH,
    generation: GENERATION,
    requestId: response.requestId,
    kind: response.kind,
    payloadBytes: response.payloadBytes,
  });
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('Authority capture dispatch ordering', () => {
  it('同一 capture 组不能让后来的 collision 越过受 reservation 阻塞的 mesh', async () => {
    const channel = new MessageChannel();
    channels.push(channel);
    const acceptedCaptureIds: number[] = [];
    let highWater = -1;
    const server = attachNodeRpcServer({
      port: channel.port2,
      epoch: EPOCH,
      generation: GENERATION,
      limits,
      validateRequest: (_kind, value) => measured(value),
      validateResponse: (_kind, value) => measured(value),
      reserveResponseBytes: (kind) =>
        kind === 'occupy-response' ? OCCUPY_RESERVATION_BYTES : reserveAuthorityResponseBytes(kind, MAX_RESPONSE_BYTES),
      handle: async ({ kind, payload }) => {
        if (kind === 'occupy-response') return { payload: { held: true } };
        const captureId = (payload as { captureId: number }).captureId;
        if (captureId <= highWater) throw new Error(`Host captureId high-water rejected ${captureId}.`);
        highWater = captureId;
        acceptedCaptureIds.push(captureId);
        return { payload: { captureId } };
      },
      dispatchOrderKey: authorityCaptureDispatchOrderKey,
    });

    const occupied = waitForResponse(channel.port1, 'occupy-response');
    post(channel.port1, 0, 'occupy-response', {});
    const occupiedResponse = await occupied;
    expect(occupiedResponse.ok).toBe(true);
    expect(server.diagnostics()).toMatchObject({ responseBytes: OCCUPY_RESERVATION_BYTES, pending: 1 });

    post(channel.port1, 1, 'authority-capture-mesh-baseline', { captureId: 0 });
    post(channel.port1, 2, 'authority-capture-collision-baseline', { captureId: 1 });
    await nextTurn();

    expect(acceptedCaptureIds).toEqual([]);

    acknowledge(channel.port1, occupiedResponse);
    const meshResponse = await waitForResponse(channel.port1, 'authority-capture-mesh-baseline');
    expect(meshResponse).toMatchObject({ ok: true, payload: { captureId: 0 } });
    expect(acceptedCaptureIds).toEqual([0]);
    acknowledge(channel.port1, meshResponse);

    const collisionResponse = await waitForResponse(channel.port1, 'authority-capture-collision-baseline');
    expect(collisionResponse).toMatchObject({ ok: true, payload: { captureId: 1 } });
    expect(acceptedCaptureIds).toEqual([0, 1]);
    acknowledge(channel.port1, collisionResponse);
    await nextTurn();
    expect(server.diagnostics()).toMatchObject({ pending: 0, responseBytes: 0 });
    server.close();
  });
});
