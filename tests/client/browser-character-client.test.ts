import { describe, expect, it } from 'vitest';
import { BrowserAuthorityClient } from '../../apps/web/src/client/authority/browser-authority-client';
import type { AuthorityWorkerPort } from '../../apps/web/src/client/authority/browser-authority-client-contract';
import type { AuthorityResponse } from '../../packages/game-core/src/compute/authority-worker-protocol';
import type { ControlBinding } from '../../packages/game-core/src/runtime/character-control-protocol';

class FakeWorker implements AuthorityWorkerPort {
  onmessage: ((event: MessageEvent<AuthorityResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posts: Record<string, unknown>[] = [];
  postMessage(message: unknown) {
    this.posts.push(message as Record<string, unknown>);
  }
  terminate() {}
  respond(requestId: number, result: unknown) {
    this.onmessage?.({
      data: { kind: 'authority-response', protocolVersion: 1, epoch: 'transport', requestId, ok: true, result },
    } as MessageEvent<AuthorityResponse>);
  }
}

const binding: ControlBinding = {
  sessionId: 'control-1',
  worldId: 'world-id',
  epoch: 'world:0',
  entityId: 'npc-1',
  incarnation: 'character-1',
  policyRevision: 1,
};

describe('Browser character client', () => {
  it('exposes trusted reads and a disposable sequence-bound control port', async () => {
    const worker = new FakeWorker();
    const client = new BrowserAuthorityClient(worker, 'transport');
    const listing = client.character({ kind: 'list' });
    const listRequest = worker.posts.at(-1)!;
    expect(listRequest).toMatchObject({ kind: 'character-control', request: { kind: 'list' } });
    worker.respond(listRequest.requestId as number, {
      ok: true,
      data: { kind: 'list', characters: [] },
      frontier: {
        worldId: 'world-id',
        epoch: 'world:0',
        worldRevision: 0,
        commitSequence: 0,
        physicsTick: 0,
        fluidWorkSequence: 0,
        logicObservationSequence: 0,
      },
    });
    await expect(listing).resolves.toMatchObject({ ok: true, data: { kind: 'list' } });

    const bindingPromise = client.bindCharacter('npc-1');
    const bindRequest = worker.posts.at(-1)!;
    expect(bindRequest).toMatchObject({ kind: 'bind-character', entityId: 'npc-1' });
    worker.respond(bindRequest.requestId as number, binding);
    const port = await bindingPromise;
    expect(port.binding).toEqual(binding);

    const observing = port.observe(4);
    const observeRequest = worker.posts.at(-1)!;
    expect(observeRequest).toMatchObject({
      kind: 'bound-character-control',
      binding,
      sequence: 1,
      request: { kind: 'observe', entityId: 'npc-1', sinceCursor: 4 },
    });
    worker.respond(observeRequest.requestId as number, {
      ok: false,
      error: { code: 'X', message: 'x', kind: 'conflict' },
    });
    await expect(observing).resolves.toMatchObject({ ok: false });

    const disposing = port.dispose();
    const disposeRequest = worker.posts.at(-1)!;
    expect(disposeRequest).toMatchObject({ kind: 'unbind-character', binding });
    worker.respond(disposeRequest.requestId as number, { unbound: true });
    await disposing;
    await expect(port.observe()).rejects.toThrow(/disposed/);
  });
});
