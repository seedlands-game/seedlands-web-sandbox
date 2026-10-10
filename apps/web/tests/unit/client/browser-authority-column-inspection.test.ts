import { requestBrowserColumnSource } from '../../../src/client/authority/browser-authority-column-source';
import { requestBrowserSkyChunk } from '../../../src/client/authority/browser-authority-sky-chunk';
import { describe, expect, it } from 'vitest';
import { BrowserAuthorityClient } from '../../../src/client/authority/browser-authority-client';
import { FakeAuthorityWorker } from './fixtures/browser-authority';

describe('Browser Authority column inspection', () => {
  it.each(['epoch', 'key', 'reason'] as const)(
    'does not retry an unowned or permanent Sky failure: %s',
    async (failure) => {
      let epoch = 'world:1';
      const request = async () => {
        if (failure === 'epoch') epoch = 'world:2';
        return {
          status: 'unavailable',
          key: failure === 'key' ? '0,4,0' : '0,3,0',
          reason: failure === 'reason' ? 'invalid-data' : 'superseded',
        };
      };
      await expect(requestBrowserSkyChunk(request, () => epoch, 0, 3, 0, 7)).resolves.toBeNull();
    },
  );
  it.each(['key', 'revision', 'shape'] as const)('rejects a Sky baseline with wrong %s', async (failure) => {
    const payload = {
      status: 'available',
      key: failure === 'key' ? '0,4,0' : '0,3,0',
      chunkRevision: failure === 'revision' ? 8 : 7,
      canonical: new ArrayBuffer(failure === 'shape' ? 1 : 65536),
      fluid: new ArrayBuffer(32768),
    };
    await expect(
      requestBrowserSkyChunk(
        async () => payload,
        () => 'world:1',
        0,
        3,
        0,
        7,
      ),
    ).resolves.toBeNull();
  });
  it('discards the exact Sky copy if the runtime changes during transfer', async () => {
    let epoch = 'world:1';
    const request = async () => {
      epoch = 'world:2';
      return {
        status: 'available',
        key: '0,3,0',
        chunkRevision: 7,
        canonical: new ArrayBuffer(65536),
        fluid: new ArrayBuffer(32768),
      };
    };
    await expect(requestBrowserSkyChunk(request, () => epoch, 0, 3, 0, 7)).resolves.toBeNull();
  });
  it('reads an exact versioned transferred Sky copy without inserting a collision or mesh resource', async () => {
    const worker = new FakeAuthorityWorker();
    const client = new BrowserAuthorityClient(worker, 'world:1');
    const pending = client.readSkyColumnChunk(0, 3, 0, 7);
    const request = worker.posts.at(-1) as { requestId: number };
    expect(request).toMatchObject({
      kind: 'request-sky-source',
      key: '0,3,0',
      minimumRevision: 7,
      runtimeEpoch: 'world:1',
    });
    worker.emit({
      kind: 'authority-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: request.requestId,
      ok: true,
      result: {
        status: 'available',
        key: '0,3,0',
        chunkRevision: 7,
        canonical: new ArrayBuffer(65536),
        fluid: new ArrayBuffer(32768),
      },
    });
    await expect(pending).resolves.toMatchObject({ revision: 7, canonical: expect.any(Uint16Array) });
    expect(client.getChunkRevision(0, 3, 0)).toBeNull();
    expect(worker.posts).toHaveLength(1);
  });
  it('reads a durable nonresident Sky source without claiming collision residency', async () => {
    const canonical = new Uint16Array(32768);
    canonical[19] = 3;
    const request = async (message: Record<string, unknown>) =>
      message.kind === 'request-sky-source'
        ? {
            status: 'available',
            key: '0,3,0',
            chunkRevision: 7,
            canonical: canonical.buffer,
            fluid: new ArrayBuffer(32768),
          }
        : { status: 'unavailable', key: '0,3,0' };
    const source = await requestBrowserSkyChunk(request, () => 'world:1', 0, 3, 0, 7);
    expect(source?.canonical[19]).toBe(3);
    expect(source?.revision).toBe(7);
  });
  it('rejects a late response after the client runtime epoch changes', async () => {
    let epoch = 'old';
    let release!: (value: unknown) => void;
    const pending = requestBrowserColumnSource(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      () => epoch,
      0,
      0,
    );
    epoch = 'new';
    release({ status: 'complete', epoch: 1 });
    await expect(pending).resolves.toEqual({ status: 'unknown', reason: 'superseded' });
  });
  it('normal renderer metadata uses its current runtime envelope without granting World chunk read', async () => {
    const worker = new FakeAuthorityWorker();
    const client = new BrowserAuthorityClient(worker, 'world:1');
    const pending = client.inspectColumnSource(0, 0);
    const request = worker.posts.at(-1) as { requestId: number };
    expect(request).toMatchObject({
      kind: 'request-column-source',
      cx: 0,
      cz: 0,
      epoch: 'world:1',
      runtimeEpoch: 'world:1',
    });
    worker.emit({
      kind: 'authority-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: request.requestId,
      ok: true,
      result: { status: 'unknown', reason: 'source-unavailable' },
    });
    await expect(pending).resolves.toEqual({ status: 'unknown', reason: 'source-unavailable' });
  });

  it('carries column metadata through the existing inspect RPC without a mesh request', async () => {
    const worker = new FakeAuthorityWorker();
    const client = new BrowserAuthorityClient(worker, 'world:1');
    const inspecting = client.world.inspect({ kind: 'column-source', column: [7, -4] });
    const request = worker.posts.at(-1) as { requestId: number };
    expect(worker.posts).toHaveLength(1);
    expect(request).toMatchObject({
      kind: 'world-harness-rpc',
      method: 'inspect',
      args: [{ kind: 'column-source', column: [7, -4] }],
    });
    worker.emit({
      kind: 'world-harness-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: request.requestId,
      result: {
        ok: true,
        data: {
          kind: 'column-source',
          source: {
            status: 'complete',
            cx: 7,
            cz: -4,
            epoch: 1,
            worldRevision: 0,
            directoryRevision: 0,
            generatedEmptyAboveY: 51,
            entries: [],
          },
        },
        frontier: {
          worldId: 'seedlands:g3:worker-client',
          epoch: 'world:1:world:0',
          worldRevision: 0,
          commitSequence: 0,
          physicsTick: 0,
          fluidWorkSequence: 0,
          logicObservationSequence: 0,
        },
      },
    });
    await expect(inspecting).resolves.toMatchObject({ ok: true, data: { source: { cx: 7, cz: -4 } } });
    expect(worker.posts).toHaveLength(1);
  });
});
