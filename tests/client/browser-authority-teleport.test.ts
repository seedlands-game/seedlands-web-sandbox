import { expect, it, vi } from 'vitest';
import { BrowserAuthorityClient, type AuthorityWorkerPort } from '../../src/client/browser-authority-client';
import type { AuthoritySnapshot } from '../../src/server/authority/authority-session';
import type { AuthorityResponse } from '../../src/worker/authority-worker-protocol';

class FakeWorker implements AuthorityWorkerPort {
  onmessage: ((event: MessageEvent<AuthorityResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posts: unknown[] = [];
  postMessage(message: unknown) {
    this.posts.push(message);
  }
  terminate() {}
  emit(message: AuthorityResponse) {
    this.onmessage?.({ data: message } as MessageEvent<AuthorityResponse>);
  }
}

const snapshot = (physicsTick: number, x: number): AuthoritySnapshot => ({
  kind: 'snapshot',
  protocolVersion: 1,
  epoch: 'world:1',
  physicsTick,
  commitSequence: physicsTick,
  worldMutationCount: 0,
  acknowledgedInputSequence: -1,
  inputResyncRequired: false,
  activeTimeMs: physicsTick * 16,
  integratedPhysicsTimeMs: physicsTick * 16,
  physicsDebtMs: 0,
  player: {
    id: 'player-1',
    type: 'player',
    body: { position: { x, y: 57, z: 0.5 }, velocity: { x: 0, y: 0, z: 0 } },
    grounded: true,
    contacts: [],
  },
  entities: [],
  chunkRevisions: { '0,1,0': 2 },
  worldRevision: 2,
  worldTime: 9,
  paused: false,
});

it('以传送事务回执的权威快照推进门槛并拒绝随后到达的旧位置', async () => {
  const worker = new FakeWorker();
  const snapshots = vi.fn();
  const client = new BrowserAuthorityClient(worker, 'world:1', { onSnapshot: snapshots });
  const moving = client.setPlayerPosition([8.5, 57, 0.5]);
  const request = worker.posts.at(-1) as { requestId: number };
  worker.emit({
    kind: 'authority-response',
    protocolVersion: 1,
    epoch: 'world:1',
    requestId: request.requestId,
    ok: true,
    result: { moved: true, snapshot: snapshot(4, 8.5) },
  });

  await moving;
  expect(client.snapshot?.player.body.position.x).toBe(8.5);
  expect(snapshots).toHaveBeenCalledTimes(1);
  worker.emit({ kind: 'authority-snapshot', protocolVersion: 1, epoch: 'world:1', snapshot: snapshot(3, 0.5) });
  expect(client.snapshot?.physicsTick).toBe(4);
  expect(snapshots).toHaveBeenCalledTimes(1);
});
