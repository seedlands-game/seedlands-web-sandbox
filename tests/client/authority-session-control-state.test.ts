import { describe, expect, it, vi } from 'vitest';
import { AuthoritySnapshotGate } from '../../src/client/authority/authority-snapshot-gate';
import { BrowserAuthorityClient, type AuthorityWorkerPort } from '../../src/client/authority/browser-authority-client';
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

const snapshot = (paused: boolean): AuthoritySnapshot => ({
  kind: 'snapshot',
  protocolVersion: 1,
  epoch: 'world:1',
  physicsTick: 4,
  commitSequence: 3,
  worldMutationCount: 0,
  acknowledgedInputSequence: 2,
  inputResyncRequired: false,
  activeTimeMs: 100,
  integratedPhysicsTimeMs: 100,
  physicsDebtMs: 0,
  player: {
    id: 'player-1',
    type: 'player',
    body: { position: { x: 0.5, y: 57, z: 0.5 }, velocity: { x: 0, y: 0, z: 0 } },
    grounded: true,
    contacts: [],
  },
  entities: [],
  chunkRevisions: {},
  worldRevision: 0,
  worldTime: 9,
  paused,
});

describe('Authority会话控制状态', () => {
  it('同版本的暂停状态变化可发布而完全重复仍拒绝', () => {
    const gate = new AuthoritySnapshotGate('world:1');
    expect(gate.accept(snapshot(false))).toBeNull();
    expect(gate.accept(snapshot(true))).toBeNull();
    expect(gate.accept(snapshot(true))).toBe('duplicate');
  });

  it('暂停回执立即发布已冻结的权威快照', async () => {
    const worker = new FakeWorker();
    const onSnapshot = vi.fn();
    const client = new BrowserAuthorityClient(worker, 'world:1', { onSnapshot });
    const pausing = client.pause();
    const request = worker.posts.at(-1) as { requestId: number };
    worker.emit({
      kind: 'authority-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: request.requestId,
      ok: true,
      result: { paused: true, snapshot: snapshot(true) },
    });

    await expect(pausing).resolves.toEqual({ paused: true });
    expect(client.snapshot?.paused).toBe(true);
    expect(onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ paused: true }));
  });
});
