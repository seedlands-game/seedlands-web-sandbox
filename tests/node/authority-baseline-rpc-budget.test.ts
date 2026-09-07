import { afterEach, describe, expect, it } from 'vitest';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import {
  authorityBaselineCaptureTransfer,
  reserveAuthorityResponseBytes,
} from '../../src/node/runtime/node-authority-baseline-protocol';
import {
  validateAuthorityRequestPayload,
  validateAuthorityResponsePayload,
} from '../../src/node/runtime/node-authority-lane-protocol';
import { attachNodeRpcServer, type NodeRpcResponse } from '../../src/node/runtime/node-rpc-contract';
import { CHUNK_SIZE, chunkKey } from '../../src/world/voxel';

const EPOCH = 'baseline-rpc-budget';
const GENERATION = 0;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const RAW_BLOCK_BYTES = CHUNK_SIZE ** 3 * (Uint16Array.BYTES_PER_ELEMENT + Uint8Array.BYTES_PER_ELEMENT);
const MESH_RAW_BLOCK_BYTES = 27 * RAW_BLOCK_BYTES;

const limits = {
  maxRequests: 4,
  maxQueuedBytes: 64 * 1024,
  maxInFlightBytes: 64 * 1024,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  maxReservedResponseBytes: 2 * MAX_RESPONSE_BYTES,
  maxConcurrentRequests: 1,
};

type CaptureResult = Readonly<{
  status: 'available';
  captureId: number;
  captureGeneration: number;
  purpose: 'mesh' | 'collision-resync';
  key: string;
  checkpoint: Readonly<{ epoch: string; physicsTick: number; commitSequence: number; worldRevision: number }>;
  entries: readonly Readonly<{
    role: 'main' | 'overlay' | 'collision-resync';
    key: string;
    chunkRevision: number;
    generatorVersion: number;
    canonical: ArrayBuffer;
    fluid: ArrayBuffer;
  }>[];
}>;

type Cancellation = Readonly<{
  captureId: number;
  captureGeneration: number | null;
  status: 'cancelled' | 'already-settled' | 'unknown';
}>;

const pendingChannels: MessageChannel[] = [];

afterEach(() => {
  for (const channel of pendingChannels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

function meshKeys(cx: number, cy: number, cz: number): string[] {
  const main = chunkKey(cx, cy, cz);
  const overlays: string[] = [];
  for (let y = cy - 1; y <= cy + 1; y += 1)
    for (let z = cz - 1; z <= cz + 1; z += 1)
      for (let x = cx - 1; x <= cx + 1; x += 1) {
        const key = chunkKey(x, y, z);
        if (key !== main) overlays.push(key);
      }
  return [main, ...overlays];
}

function blocks(index: number): Readonly<{ canonical: ArrayBuffer; fluid: ArrayBuffer }> {
  const canonical = new ArrayBuffer(CHUNK_SIZE ** 3 * Uint16Array.BYTES_PER_ELEMENT);
  const fluid = new ArrayBuffer(CHUNK_SIZE ** 3 * Uint8Array.BYTES_PER_ELEMENT);
  new Uint8Array(canonical)[0] = index;
  new Uint8Array(fluid)[0] = 255 - index;
  return { canonical, fluid };
}

function availableMesh(): CaptureResult {
  const keys = meshKeys(4, 2, -3);
  return {
    status: 'available',
    captureId: 7,
    captureGeneration: 0,
    purpose: 'mesh',
    key: keys[0]!,
    checkpoint: { epoch: EPOCH, physicsTick: 120, commitSequence: 19, worldRevision: 6 },
    entries: keys.map((key, index) => ({
      role: index === 0 ? 'main' : 'overlay',
      key,
      chunkRevision: index + 3,
      generatorVersion: 4,
      ...blocks(index),
    })),
  };
}

function availableCollision(): CaptureResult {
  const key = '11,0,-8';
  return {
    status: 'available',
    captureId: 8,
    captureGeneration: 0,
    purpose: 'collision-resync',
    key,
    checkpoint: { epoch: EPOCH, physicsTick: 121, commitSequence: 20, worldRevision: 7 },
    entries: [{ role: 'collision-resync', key, chunkRevision: 9, generatorVersion: 4, ...blocks(63) }],
  };
}

function waitForMessage(port: MessagePort): Promise<NodeRpcResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for Node RPC response.')), 5_000);
    port.once('message', (value: unknown) => {
      clearTimeout(timer);
      resolve(value as NodeRpcResponse);
    });
  });
}

async function settlePort(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function postRawRequest(port: MessagePort, kind: string, value: unknown, requestId = 0): Promise<NodeRpcResponse> {
  const measured = validateAuthorityRequestPayload(kind, value);
  const response = waitForMessage(port);
  port.postMessage({
    type: 'request',
    epoch: EPOCH,
    generation: GENERATION,
    requestId,
    kind,
    payload: measured.value,
    payloadBytes: measured.bytes,
  });
  return response;
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

describe('Authority baseline capture RPC transfer and response budget', () => {
  it('通过真实 MessageChannel 转移完整 mesh 的 54 个 buffer，并在有效 ACK 前保留 4 MiB reservation', async () => {
    const channel = new MessageChannel();
    pendingChannels.push(channel);
    const source = availableMesh();
    const sourceBuffers = authorityBaselineCaptureTransfer(source);
    const server = attachNodeRpcServer({
      port: channel.port2,
      epoch: EPOCH,
      generation: GENERATION,
      limits,
      validateRequest: validateAuthorityRequestPayload,
      validateResponse: validateAuthorityResponsePayload,
      reserveResponseBytes: (kind) => reserveAuthorityResponseBytes(kind, limits.maxResponseBytes),
      handle: async () => ({ payload: source, transfer: sourceBuffers }),
    });

    const response = await postRawRequest(channel.port1, 'authority-capture-mesh-baseline', {
      captureId: source.captureId,
      purpose: source.purpose,
      key: source.key,
      minimumRevision: 0,
    });
    expect(response).toMatchObject({ ok: true, kind: 'authority-capture-mesh-baseline', requestId: 0 });
    if (!response.ok) throw new Error(response.error);
    const measured = validateAuthorityResponsePayload(response.kind, response.payload);
    expect(response.payloadBytes).toBe(measured.bytes);
    expect(measured.bytes).toBeGreaterThan(MESH_RAW_BLOCK_BYTES);
    expect(measured.bytes).toBeLessThan(MAX_RESPONSE_BYTES);
    expect(source.entries).toHaveLength(27);
    expect(sourceBuffers).toHaveLength(54);
    expect(new Set(sourceBuffers).size).toBe(54);
    expect(sourceBuffers.every((buffer) => buffer.byteLength === 0)).toBe(true);

    const client = measured.value as CaptureResult;
    expect(client.entries).toHaveLength(27);
    expect(client.entries.map((entry) => entry.key)).toEqual(meshKeys(4, 2, -3));
    expect(
      client.entries.flatMap((entry) => [entry.canonical, entry.fluid]).every((buffer) => buffer.byteLength > 0),
    ).toBe(true);
    new Uint8Array(client.entries[0]!.canonical)[0] = 173;
    expect(new Uint8Array(client.entries[0]!.canonical)[0]).toBe(173);

    expect(server.diagnostics()).toMatchObject({ pending: 1, responseBytes: MAX_RESPONSE_BYTES });
    acknowledge(channel.port1, response);
    await settlePort();
    expect(server.diagnostics()).toMatchObject({ pending: 0, responseBytes: 0 });
    server.close();
  });

  it('转移 collision 单块的两个 buffer，并按 128 KiB reservation 在 ACK 前保留额度', async () => {
    const channel = new MessageChannel();
    pendingChannels.push(channel);
    const source = availableCollision();
    const sourceBuffers = authorityBaselineCaptureTransfer(source);
    const server = attachNodeRpcServer({
      port: channel.port2,
      epoch: EPOCH,
      generation: GENERATION,
      limits,
      validateRequest: validateAuthorityRequestPayload,
      validateResponse: validateAuthorityResponsePayload,
      reserveResponseBytes: (kind) => reserveAuthorityResponseBytes(kind, limits.maxResponseBytes),
      handle: async () => ({ payload: source, transfer: sourceBuffers }),
    });

    const response = await postRawRequest(channel.port1, 'authority-capture-collision-baseline', {
      captureId: source.captureId,
      purpose: source.purpose,
      key: source.key,
      minimumRevision: 9,
    });
    expect(response).toMatchObject({ ok: true, kind: 'authority-capture-collision-baseline' });
    if (!response.ok) throw new Error(response.error);
    const client = validateAuthorityResponsePayload(response.kind, response.payload).value as CaptureResult;
    expect(client.entries).toHaveLength(1);
    expect(client.entries[0]).toMatchObject({ role: 'collision-resync', key: source.key, chunkRevision: 9 });
    expect(sourceBuffers).toHaveLength(2);
    expect(sourceBuffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
    expect(server.diagnostics()).toMatchObject({ pending: 1, responseBytes: 128 * 1024 });
    acknowledge(channel.port1, response);
    await settlePort();
    expect(server.diagnostics()).toMatchObject({ pending: 0, responseBytes: 0 });
    server.close();
  });

  it('collision 的超大 checkpoint epoch 超过 128 KiB reservation 时拒绝，而不截断或放宽额度', async () => {
    const channel = new MessageChannel();
    pendingChannels.push(channel);
    const source = {
      ...availableCollision(),
      checkpoint: {
        ...availableCollision().checkpoint,
        epoch: 'e'.repeat(130 * 1024),
      },
    };
    const sourceBuffers = authorityBaselineCaptureTransfer(source);
    const server = attachNodeRpcServer({
      port: channel.port2,
      epoch: EPOCH,
      generation: GENERATION,
      limits,
      validateRequest: validateAuthorityRequestPayload,
      validateResponse: validateAuthorityResponsePayload,
      reserveResponseBytes: (kind) => reserveAuthorityResponseBytes(kind, limits.maxResponseBytes),
      handle: async () => ({ payload: source, transfer: sourceBuffers }),
    });

    const response = await postRawRequest(channel.port1, 'authority-capture-collision-baseline', {
      captureId: source.captureId,
      purpose: source.purpose,
      key: source.key,
      minimumRevision: 9,
    });
    expect(response).toMatchObject({ ok: false, kind: 'authority-capture-collision-baseline', payloadBytes: 0 });
    if (response.ok) throw new Error('Expected oversized collision response to be rejected.');
    expect(response.error).toMatch(/reservation/i);
    expect(sourceBuffers.every((buffer) => buffer.byteLength > 0)).toBe(true);
    expect(server.diagnostics()).toMatchObject({ pending: 1, responseBytes: 128 * 1024 });
    acknowledge(channel.port1, response);
    await settlePort();
    expect(server.diagnostics()).toMatchObject({ pending: 0, responseBytes: 0 });
    server.close();
  });

  it('为 cancel 使用固定 1 KiB reservation 且回复不携带 block', async () => {
    const channel = new MessageChannel();
    pendingChannels.push(channel);
    const cancellation: Cancellation = { captureId: 9, captureGeneration: 0, status: 'cancelled' };
    const server = attachNodeRpcServer({
      port: channel.port2,
      epoch: EPOCH,
      generation: GENERATION,
      limits,
      validateRequest: validateAuthorityRequestPayload,
      validateResponse: validateAuthorityResponsePayload,
      reserveResponseBytes: (kind) => reserveAuthorityResponseBytes(kind, limits.maxResponseBytes),
      handle: async () => ({ payload: cancellation }),
    });

    const response = await postRawRequest(channel.port1, 'authority-cancel-baseline-capture', { captureId: 9 });
    expect(response).toMatchObject({ ok: true, kind: 'authority-cancel-baseline-capture' });
    if (!response.ok) throw new Error(response.error);
    expect(validateAuthorityResponsePayload(response.kind, response.payload).value).toEqual(cancellation);
    expect(JSON.stringify(response.payload)).not.toContain('canonical');
    expect(JSON.stringify(response.payload)).not.toContain('fluid');
    expect(server.diagnostics()).toMatchObject({ pending: 1, responseBytes: 1024 });
    acknowledge(channel.port1, response);
    await settlePort();
    expect(server.diagnostics()).toMatchObject({ pending: 0, responseBytes: 0 });
    server.close();
  });

  it('冻结三类 reservation 上限，并在低 maxResponseBytes 时向下收紧', () => {
    expect(reserveAuthorityResponseBytes('authority-capture-mesh-baseline', MAX_RESPONSE_BYTES)).toBe(
      MAX_RESPONSE_BYTES,
    );
    expect(reserveAuthorityResponseBytes('authority-capture-collision-baseline', MAX_RESPONSE_BYTES)).toBe(128 * 1024);
    expect(reserveAuthorityResponseBytes('authority-cancel-baseline-capture', MAX_RESPONSE_BYTES)).toBe(1024);
    expect(reserveAuthorityResponseBytes('other-kind', 9_999)).toBe(9_999);
    expect(reserveAuthorityResponseBytes('authority-capture-collision-baseline', 4_096)).toBe(4_096);
    expect(reserveAuthorityResponseBytes('authority-cancel-baseline-capture', 17)).toBe(17);
  });
});
