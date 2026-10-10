import { describe, expect, it } from 'vitest';
import { BrowserAuthorityClient } from '../../../src/client/authority/browser-authority-client';
import { FakeAuthorityWorker } from './fixtures/browser-authority';

describe('Browser Authority column inspection', () => {
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
