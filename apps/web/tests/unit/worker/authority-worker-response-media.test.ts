import { describe, expect, it, vi } from 'vitest';
import type { AuthorityRuntime } from '@seedlands/stdlib/server/authority/authority-runtime';
import type { MediaPlaybackCommittedBatchV1 } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { transactAuthorityRequest } from '../../../src/worker/authority-worker-response';

const batch = (revision: number): MediaPlaybackCommittedBatchV1 => ({
  version: 1,
  worldEpoch: 'runtime:2',
  worldRevision: 0,
  gameplayRevision: 4,
  facts: [
    {
      version: 1,
      kind: 'activate',
      device: { kind: 'voxel', position: [revision, 2, 3], definitionId: 'sample:device' },
      revision,
      previousTrackId: 'sample:track',
      trackId: 'sample:track',
      resource: { packId: 'sample:pack', path: 'assets/audio/track.mp3' },
      playing: true,
      resumePending: false,
    },
  ],
});

const message = {
  kind: 'set-world-time' as const,
  protocolVersion: 1 as const,
  epoch: 'session:1',
  requestId: 8,
  transaction: { issuer: 'browser:session:1', stream: 'world-time', sequence: 0 },
  hours: 4,
};

describe('authority transaction media publication', () => {
  it('posts gameplay response before every committed media batch and drains once', async () => {
    const pending = [batch(1), batch(2)];
    const current = {
      executeTransaction: vi.fn(async (_transaction, operation: () => unknown) => ({
        status: 'executed' as const,
        commitSequence: 9,
        result: await operation(),
      })),
      takeMediaFacts: vi.fn(() => pending.splice(0)),
    } as unknown as AuthorityRuntime;
    const post = vi.fn();

    await transactAuthorityRequest(
      post,
      'session:1',
      'runtime:2',
      current,
      message,
      () =>
        ({
          result: { worldTime: 4 },
          gameplay: { gameplayRevision: 4 },
        }) as never,
    );

    expect(post.mock.calls.map(([value]) => value.kind)).toEqual([
      'authority-response',
      'authority-media-facts',
      'authority-media-facts',
    ]);
    expect(current.takeMediaFacts).toHaveBeenCalledOnce();
    expect(current.takeMediaFacts).toHaveBeenCalledWith('runtime:2');
    expect(post.mock.calls.slice(1).map(([value]) => [value.epoch, value.batch.worldEpoch])).toEqual([
      ['session:1', 'runtime:2'],
      ['session:1', 'runtime:2'],
    ]);
  });

  it('does not drain or publish media for a rejected transaction', async () => {
    const current = {
      executeTransaction: vi.fn(async () => ({ status: 'stale' as const, commitSequence: 7 })),
      takeMediaFacts: vi.fn(() => [batch(1)]),
    } as unknown as AuthorityRuntime;
    const post = vi.fn();

    await transactAuthorityRequest(post, 'session:1', 'runtime:2', current, message, () => ({ result: null }));

    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ kind: 'authority-response', ok: false }));
    expect(current.takeMediaFacts).not.toHaveBeenCalled();
  });
});
