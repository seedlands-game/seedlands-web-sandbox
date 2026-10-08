import { expect, it, vi } from 'vitest';
import { BrowserAuthorityClient } from '../../../src/client/authority/browser-authority-client';
import type {
  PointerAttackRequest,
  PointerAttackResponse,
} from '../../../src/client/authority/pointer-attack-protocol';
import { FakeAuthorityWorker, frequencies, ready } from './fixtures/browser-authority';

async function driver() {
  const worker = new FakeAuthorityWorker();
  const result = vi.fn();
  const onGameplay = vi.fn();
  const client = new BrowserAuthorityClient(worker, 'world:1', { onPointerAttackResult: result, onGameplay });
  const starting = client.start({
    seedText: 'pointer',
    openMode: 'continue',
    legacySnapshots: [],
    initialWorldTime: 9,
    frequencies,
  });
  worker.emit({ kind: 'authority-ready', protocolVersion: 1, epoch: 'world:1', ready: ready() });
  await starting;
  const receipt = (sequence: number, revision: number): PointerAttackResponse => ({
    kind: 'pointer-attack-result',
    protocolVersion: 1,
    epoch: 'world:1',
    runtimeEpoch: 'world:1',
    sequence,
    result: {
      result: { success: true, sequence },
      gameplay: { ...ready().gameplay, gameplayRevision: revision },
      commits: [],
    },
  });
  return { worker, client, result, onGameplay, receipt };
}

it('actual client copies mouse direction and uses fresh gestures after releases', async () => {
  const d = await driver();
  try {
    const direction: [number, number, number] = [0, 0, -1];
    d.client.sendPointerAttack(direction);
    direction[2] = 1;
    d.client.sendPointerAttack([1, 0, 0]);
    d.client.sendPointerAttack(null);
    d.client.sendPointerAttack([0, 0, -1]);
    const posts = d.worker.posts.filter(
      (post) => (post as PointerAttackRequest).kind === 'pointer-attack-input',
    ) as PointerAttackRequest[];
    expect(posts.map((post) => post.input)).toMatchObject([
      { sequence: 0, gesture: 1, direction: [0, 0, -1] },
      { sequence: 1, gesture: 1, direction: [1, 0, 0] },
      { sequence: 2, gesture: 1, direction: null },
      { sequence: 3, gesture: 2, direction: [0, 0, -1] },
    ]);
    expect(
      posts.every((post) => post.runtimeEpoch === 'world:1' && Number.isFinite(post.input.capturedAtTimeOriginMs)),
    ).toBe(true);
  } finally {
    d.client.dispose();
  }
});

it('real client consumes reordered receipts once while preserving newest gameplay and rejecting stale worlds', async () => {
  const d = await driver();
  try {
    d.worker.emit(d.receipt(2, 3));
    d.worker.emit(d.receipt(1, 2));
    d.worker.emit(d.receipt(2, 3));
    d.worker.emit({ ...d.receipt(3, 4), runtimeEpoch: 'retired-world' });
    d.worker.emit({ ...d.receipt(3, 4), epoch: 'other-session' });
    expect(d.result.mock.calls.map(([value]) => value.sequence)).toEqual([2, 1]);
    expect(d.client.gameplay.gameplayRevision).toBe(3);
    d.worker.emit(d.receipt(100, 4));
    d.worker.emit(d.receipt(0, 2));
    expect(d.result).toHaveBeenCalledTimes(3);
    expect(d.client.gameplay.gameplayRevision).toBe(4);
  } finally {
    d.client.dispose();
  }
});
